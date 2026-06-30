/**
 * pi-cc-compact
 *
 * Ports Claude Code's full-compaction prompt to pi's `session_before_compact` hook.
 *
 * The prompt is a faithful reconstruction of the one Anthropic ships inside
 * `@anthropic-ai/claude-code` (observed via the v2.1.68 deobfuscation and the
 * `compact_service` prompt leak). It asks the summarizer to:
 *   1. Wrap reasoning in <analysis>...</analysis>
 *   2. Emit a structured <summary>...</summary> with 9 fixed sections
 *
 * Just like Claude Code's `formatCompactSummary()`, only the <summary> block is
 * extracted and stored — the <analysis> scratchpad is discarded.
 *
 * Model selection (matches Claude Code's "same mainLoopModel" behavior by default):
 *   - Default: the current conversation model (`ctx.model`)
 *   - Override: PI_CC_COMPACT_MODEL="provider/modelId" (e.g. "google/gemini-2.5-flash")
 *
 * Max output tokens is set to 20000, mirroring Claude Code's hard override.
 *
 * References:
 *   - pi compaction hooks: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/compaction.md
 *   - pi custom-compaction example: examples/extensions/custom-compaction.ts
 */

import { complete } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { convertToLlm, serializeConversation } from "@earendil-works/pi-coding-agent";

const MAX_OUTPUT_TOKENS = 20_000;

/**
 * Faithful reconstruction of Claude Code's BASE_COMPACT_PROMPT (full summarization)
 * combined with the DETAILED_ANALYSIS_INSTRUCTION and the NO_TOOLS_PREAMBLE.
 *
 * The 9 required sections, the <analysis>/<summary> requirement, and the no-tools
 * enforcement are all reproduced verbatim from the leaked compact_service prompt.
 */
const BASE_COMPACT_PROMPT = `CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.

- Do NOT use Read, Bash, Grep, Glob, Edit, Write, or ANY other tool.
- You already have all the context you need in the conversation above.
- Tool calls will be REJECTED and will waste your only turn — you will fail the task.
- Your entire response must be plain text: an <analysis> block followed by a <summary> block.

Your task is to create a detailed summary of the conversation so far, paying close attention to
the user's explicit requests and your previous actions.
This summary should be thorough in capturing technical details, code patterns, and architectural
decisions that would be essential for continuing development work without losing context.

Before providing your final summary, wrap your analysis in <analysis> tags to organize your
thoughts and ensure you've covered all necessary points. In your analysis process:

1. Chronologically analyze each message and section of the conversation. For each section
   thoroughly identify:
   - The user's explicit requests and intents
   - Your approach to addressing the user's requests
   - Key decisions, technical concepts and code patterns
   - Specific details like:
     - file names
     - full code snippets
     - function signatures
     - file edits
   - Errors that you ran into and how you fixed them
   - Pay special attention to specific user feedback that you received, especially if the user
     told you to do something differently.
2. Double-check for technical accuracy and completeness, addressing each required element
   thoroughly.

Your summary should include the following sections:

1. Primary Request and Intent: Capture all of the user's explicit requests and intents in detail
2. Key Technical Concepts: List all important technical concepts, technologies, and frameworks
   discussed.
3. Files and Code Sections: Enumerate specific files and code sections examined, modified, or
   created. Pay special attention to the most recent messages and include full code snippets
   where applicable and include a summary of why this file read or edit is important.
4. Errors and fixes: List all errors that you ran into, and how you fixed them. Pay special
   attention to specific user feedback that you received, especially if the user told you to do
   something differently.
5. Problem Solving: Document problems solved and any ongoing troubleshooting efforts.
6. All user messages: List ALL user messages that are not tool results. These are critical for
   understanding the users' feedback and changing intent.
7. Pending Tasks: Outline any pending tasks that you have explicitly been asked to work on.
8. Current Work: Describe in detail precisely what was being worked on immediately before this
   summary request, paying special attention to the most recent messages from both user and
   assistant. Include file names and code snippets where applicable.
9. Optional Next Step: List the next step that you will take that is related to the most recent
   work you were doing. IMPORTANT: ensure that this step is DIRECTLY in line with the user's
   most recent explicit requests, and the task you were working on immediately before this
   summary request. If there is a next step, include direct quotes from the most recent
   conversation showing exactly what task you were working on and where you left off. This should
   be verbatim to prevent any drift in task interpretation.

Example output structure:

<analysis>
[Chronological, section-by-section reasoning — this is a scratchpad and will be discarded.]
</analysis>

<summary>
1. Primary Request and Intent:
   ...
2. Key Technical Concepts:
   ...
[...all 9 sections...]
</summary>

There may be additional summarization instructions provided below.
If so, remember to follow these instructions when creating the above summary.

IMPORTANT: Do NOT use any tools. You MUST respond with ONLY the <analysis> and <summary> blocks
as your text output.`;

const COMPACT_SYSTEM_PROMPT = "You are a helpful AI assistant tasked with summarizing conversations.";

/**
 * Mirror of Claude Code's `formatCompactSummary()`: keep only the <summary> block.
 * Falls back to the full text (minus a stripped <analysis> block) if tags are absent,
 * so a non-conformant model still yields a usable summary.
 */
function extractSummary(raw: string): string {
	const match = raw.match(/<summary>([\s\S]*?)<\/summary>/i);
	if (match) return match[1].trim();

	// No <summary> tag — drop the analysis scratchpad if present, keep the rest.
	const stripped = raw.replace(/<analysis>[\s\S]*?<\/analysis>/i, "").trim();
	return stripped || raw.trim();
}

function resolveModel(ctx: { model: unknown; modelRegistry: { find: (provider: string, id: string) => unknown } }) {
	const override = process.env.PI_CC_COMPACT_MODEL;
	if (override) {
		const slash = override.indexOf("/");
		if (slash > 0) {
			const provider = override.slice(0, slash);
			const id = override.slice(slash + 1);
			const found = ctx.modelRegistry.find(provider, id);
			if (found) return { model: found, label: override };
		}
		// Malformed override — warn but continue to default.
		console.warn(`[pi-cc-compact] Ignoring malformed PI_CC_COMPACT_MODEL="${override}" (expected "provider/modelId")`);
	}
	// Default: same model as the conversation (Claude Code uses mainLoopModel).
	return { model: ctx.model, label: "current conversation model" };
}

export default function (pi: ExtensionAPI) {
	pi.on("session_before_compact", async (event, ctx) => {
		const { preparation, customInstructions, signal } = event;
		const { messagesToSummarize, turnPrefixMessages, tokensBefore, firstKeptEntryId, previousSummary } = preparation;

		// Summarize both the completed turns and any split-turn prefix together.
		const allMessages = [...messagesToSummarize, ...turnPrefixMessages];
		if (allMessages.length === 0) return; // nothing to summarize -> default compaction

		const { model, label } = resolveModel(ctx);
		if (!model) {
			ctx.ui.notify("[pi-cc-compact] No model available, falling back to default compaction", "warning");
			return;
		}

		// Resolve auth for the chosen model.
		// @ts-expect-error - getApiKeyAndHeaders is present on ModelRegistry at runtime.
		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
		if (!auth.ok || !auth.apiKey) {
			ctx.ui.notify(`[pi-cc-compact] No API key for compaction model, using default compaction`, "warning");
			return;
		}

		const conversationText = serializeConversation(convertToLlm(allMessages));

		const previousContext = previousSummary
			? `\n\nPrevious session summary (for iterative context — extend, do not discard):\n${previousSummary}\n`
			: "";

		const additional = customInstructions
			? `\n\nAdditional Instructions:\n${customInstructions}\n`
			: "";

		const userText = `${BASE_COMPACT_PROMPT}${previousContext}${additional}

<conversation>
${conversationText}
</conversation>`;

		ctx.ui.notify(
			`[pi-cc-compact] Summarizing ${allMessages.length} messages (${tokensBefore.toLocaleString()} tokens) with ${label}...`,
			"info",
		);

		try {
			const response = await complete(
				// @ts-expect-error - model shape is provider-internal but accepted by complete().
				model,
				{
					systemPrompt: COMPACT_SYSTEM_PROMPT,
					messages: [
						{
							role: "user",
							content: [{ type: "text", text: userText }],
							timestamp: Date.now(),
						},
					],
				},
				{
					apiKey: auth.apiKey,
					headers: auth.headers,
					maxTokens: MAX_OUTPUT_TOKENS,
					signal,
				},
			);

			const raw = response.content
				.filter((c): c is { type: "text"; text: string } => c.type === "text")
				.map((c) => c.text)
				.join("\n");

			if (!raw.trim()) {
				if (!signal.aborted) {
					ctx.ui.notify("[pi-cc-compact] Empty summary, using default compaction", "warning");
				}
				return; // fall back to default compaction
			}

			const summary = extractSummary(raw);

			return {
				compaction: {
					summary,
					firstKeptEntryId,
					tokensBefore,
					details: { source: "pi-cc-compact", model: label },
				},
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			ctx.ui.notify(`[pi-cc-compact] Compaction failed: ${message} (using default)`, "error");
			return; // fall back to default compaction on error
		}
	});
}
