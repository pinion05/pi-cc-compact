/**
 * A/B compaction experiment: pi-default prompt vs Claude-Code prompt.
 * Same corpus, same model (zai glm-4.7), 10 interleaved trials each.
 *
 * Prompts are extracted verbatim:
 *  - pi default: packages/coding-agent/dist/core/compaction/compaction.js + utils.js
 *  - CC: leaked compact_service prompt (reconstructed in pi-cc-compact/extensions/index.ts)
 */
import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { complete } from "@earendil-works/pi-ai/compat";
import { readFileSync, writeFileSync } from "node:fs";

const TRIALS = 10;
const MAX_TOKENS = 20000;

// ---------- prompts (verbatim from their sources) ----------
const PI_SYSTEM = "You are a context summarization assistant. Your task is to read a conversation between a user and an AI assistant, then produce a structured summary following the exact format specified.\n\nDo NOT continue the conversation. Do NOT respond to any questions in the conversation. ONLY output the structured summary.";

const PI_PROMPT = `The messages above are a conversation to summarize. Create a structured context checkpoint summary that another LLM will use to continue the work.

Use this EXACT format:

## Goal
[What is the user trying to accomplish? Can be multiple items if the session covers different tasks.]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned by user]
- [Or "(none)" if none were mentioned]

## Progress
### Done
- [x] [Completed tasks/changes]

### In Progress
- [ ] [Current work]

### Blocked
- [Issues preventing progress, if any]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Next Steps
1. [Ordered list of what should happen next]

## Critical Context
- [Any data, examples, or references needed to continue]
- [Or "(none)" if not applicable]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;

const CC_SYSTEM = "You are a helpful AI assistant tasked with summarizing conversations.";

const CC_PROMPT = `CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.

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
7. Pending Tasks: Outline any pending tasks that you have been explicitly asked to work on.
8. Current Work: Describe in detail precisely what was being worked on immediately before this
   summary request, paying special attention to the most recent messages of both user and
   assistant. Include file names and code snippets as applicable.
9. Optional Next Step: List the next step that you will take that is related to the most recent
   work you were doing.

Example output structure:

<analysis>
[Chronological, section-by-section reasoning — this is a scratchpad and will be discarded.]
</analysis>

<summary>
1. Primary Request and Intent:
   ...
[...all 9 sections...]
</summary>

IMPORTANT: Do NOT use any tools. You MUST respond with ONLY the <analysis> and <summary> blocks
as your text output.`;

// ---------- metric helpers ----------
const CC_SECTIONS = ["Primary Request", "Key Technical Concepts", "Files and Code", "Errors and fix", "Problem Solving", "[Aa]ll user messages", "Pending Task", "Current Work", "Next Step"];
const PI_SECTIONS = ["## Goal", "## Constraints", "## Progress", "## Key Decisions", "## Next Steps", "## Critical Context"];
// ground-truth entities from this conversation
const ENTITIES = [
  { label: "pi-cc-compact (built pkg)", re: /pi-cc-compact/i },
  { label: "Claude Code", re: /claude[ -]?code/i },
  { label: "Hypa (suspect pkg)", re: /\bhypa\b/i },
  { label: "session_before_compact hook", re: /session_before_compact/i },
  { label: "9-section/analysis format", re: /analysis.*summary|9.?section/i },
  { label: "leak source", re: /leak|deobfuscat|v2\.1\.68/i },
  { label: "extensions/index.ts (file)", re: /extensions\/index\.ts|index\.ts/i },
  { label: "GitHub publish", re: /github\.com|npm publish|배포/i },
  { label: "패키지/Korean topic", re: /패키지|pakage/i },
  { label: "OpenRouter (tried)", re: /openrouter/i },
];

function metrics(raw) {
  const chars = raw.length;
  const tokens = Math.round(chars / 4);
  const hasAnalysis = /<analysis>/i.test(raw);
  const hasSummary = /<summary>/i.test(raw);
  const entityHits = {};
  for (const e of ENTITIES) entityHits[e.label] = e.re.test(raw) ? 1 : 0;
  return { chars, tokens, hasAnalysis, hasSummary, entityHits, entityCount: Object.values(entityHits).reduce((a, b) => a + b, 0) };
}

// ---------- run (concurrency pool) ----------
const CONCURRENCY = Number(process.env.CONCURRENCY || 5);
const corpus = readFileSync(new URL("./corpus.txt", import.meta.url), "utf8");

const authStorage = AuthStorage.create();
const modelRegistry = ModelRegistry.create(authStorage);
const model = modelRegistry.find("zai", "glm-4.7");
if (!model) { console.error("glm-4.7 not found"); process.exit(1); }
const auth = await modelRegistry.getApiKeyAndHeaders(model);
if (!auth.ok || !auth.apiKey) { console.error("no zai api key:", auth.error || "?"); process.exit(1); }
console.error(`[exp] model=${model.provider}/${model.id}, corpus=${corpus.length} chars (~${Math.round(corpus.length/4)} tokens)`);

function buildMessages(prompt) {
  return [
    {
      role: "user",
      content: [{ type: "text", text: `${prompt}\n\n<conversation>\n${corpus}\n</conversation>` }],
      timestamp: Date.now(),
    },
  ];
}

async function runOnce(label, systemPrompt, userPrompt) {
  const t0 = Date.now();
  try {
    const resp = await complete(model, { systemPrompt, messages: buildMessages(userPrompt) }, {
      apiKey: auth.apiKey, headers: auth.headers, maxTokens: MAX_TOKENS,
    });
    const raw = resp.content.filter(c => c.type === "text").map(c => c.text).join("\n");
    const ms = Date.now() - t0;
    const m = metrics(raw);
    m.label = label; m.ms = ms; m.stopReason = resp.stopReason;
    m.excerpt = raw.slice(0, 600);
    m.full = raw;
    return m;
  } catch (e) {
    return { label, error: String(e.message || e), ms: Date.now() - t0 };
  }
}

// Build job list: 10 pi + 10 cc, shuffled so any rate-limit bias is spread.
const jobs = [];
for (let i = 0; i < TRIALS; i++) {
  jobs.push({ trial: i + 1, which: "pi" });
  jobs.push({ trial: i + 1, which: "cc" });
}
// Fisher-Yates shuffle
for (let i = jobs.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [jobs[i], jobs[j]] = [jobs[j], jobs[i]];
}

// simple async pool
async function pool(items, n, worker) {
  const queue = [...items];
  const out = [];
  const runners = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (queue.length) { const it = queue.shift(); out.push(await worker(it)); }
  });
  await Promise.all(runners);
  return out;
}
let done = 0;
const raw = await pool(jobs, CONCURRENCY, async (job) => {
  const sys = job.which === "pi" ? PI_SYSTEM : CC_SYSTEM;
  const usr = job.which === "pi" ? PI_PROMPT : CC_PROMPT;
  const r = await runOnce(job.which, sys, usr);
  done++; process.stderr.write(`[exp] ${done}/${jobs.length} (${job.which} t${job.trial}) ${r.error ? "ERR" : r.chars + "ch " + r.ms + "ms"}\n`);
  return { trial: job.trial, which: job.which, result: r };
});

// re-assemble into trial rows
const byTrial = {};
for (const { trial, which, result } of raw) {
  byTrial[trial] = byTrial[trial] || { trial };
  byTrial[trial][which] = result;
}
const results = Object.values(byTrial).sort((a, b) => a.trial - b.trial);

writeFileSync(new URL("./results.json", import.meta.url), JSON.stringify(results, null, 2));
console.error("[exp] saved results.json (" + results.length + " trials)");

// print compact numeric summary
const summarize = (arr, key) => {
  const vals = arr.map(r => r[key]).filter(v => typeof v === "number");
  if (!vals.length) return "n/a";
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const min = Math.min(...vals), max = Math.max(...vals);
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
  return `mean=${mean.toFixed(0)} min=${min} max=${max} sd=${sd.toFixed(0)}`;
};
const piRuns = results.map(r => r.pi).filter(r => !r.error);
const ccRuns = results.map(r => r.cc).filter(r => !r.error);
console.log("TRIALS_OK pi=" + piRuns.length + "/" + TRIALS + " cc=" + ccRuns.length + "/" + TRIALS);
console.log("PI_CHARS " + summarize(piRuns, "chars"));
console.log("CC_CHARS " + summarize(ccRuns, "chars"));
console.log("PI_TOK   " + summarize(piRuns, "tokens"));
console.log("CC_TOK   " + summarize(ccRuns, "tokens"));
console.log("PI_MS    " + summarize(piRuns, "ms"));
console.log("CC_MS    " + summarize(ccRuns, "ms"));
console.log("PI_ENT   mean=" + (piRuns.reduce((a, r) => a + r.entityCount, 0) / piRuns.length).toFixed(2) + "/10");
console.log("CC_ENT   mean=" + (ccRuns.reduce((a, r) => a + r.entityCount, 0) / ccRuns.length).toFixed(2) + "/10");
console.log("CC_ANALYSIS_TAG " + ccRuns.filter(r => r.hasAnalysis).length + "/" + ccRuns.length);
console.log("CC_SUMMARY_TAG  " + ccRuns.filter(r => r.hasSummary).length + "/" + ccRuns.length);
