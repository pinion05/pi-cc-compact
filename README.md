# pi-cc-compact

> **Claude Code's compaction prompt, ported to [pi](https://shittycodingagent.ai).**

`pi-cc-compact` is a pi extension that replaces pi's default context-compaction
summary with the **exact 9-section `<analysis>` + `<summary>` prompt** Anthropic
ships inside Claude Code.

The prompt was reconstructed from the leaked/deobfuscated `compact_service` prompt
observed in `@anthropic-ai/claude-code` v2.1.68. Every part that matters is
reproduced faithfully:

- **System prompt:** `"You are a helpful AI assistant tasked with summarizing conversations."`
- **No-tools preamble** (`CRITICAL: Respond with TEXT ONLY...`)
- **`<analysis>` scratchpad** instruction (chronological reasoning)
- **9 required sections:** Primary Request & Intent · Key Technical Concepts ·
  Files and Code Sections · Errors and Fixes · Problem Solving · All User Messages ·
  Pending Tasks · Current Work · Optional Next Step
- **Custom instructions** support (from `/compact [instructions]`)
- **Iterative context** (previous summary carried forward)
- **`formatCompactSummary()` extraction** — only the `<summary>` block is stored;
  the `<analysis>` scratchpad is discarded, exactly like Claude Code.

It hooks pi's [`session_before_compact`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/compaction.md)
event and returns the generated summary as the compaction result.

---

## Why

Pi's default compaction summary follows pi's own `## Goal / ## Progress / ...`
format. Some users prefer the denser, intent-preserving style Claude Code uses —
in particular its insistence on listing **all user messages** and the **verbatim
last task** so intent doesn't drift across compactions. This package gives you
that style without leaving pi.

## Install

```bash
# Global (available everywhere)
pi install npm:pi-cc-compact

# Project-only
pi install -l npm:pi-cc-compact
```

Or pin a version:

```bash
pi install npm:pi-cc-compact@0.1.0
```

### Try without installing

```bash
pi -e npm:pi-cc-compact
```

## How it works

1. On compaction (auto or `/compact`), pi fires `session_before_compact` with
   `messagesToSummarize` + any split-turn prefix.
2. This extension serializes those messages to text (`serializeConversation`),
   prepends the reconstructed Claude Code prompt, and calls the model.
3. The `<summary>` block is extracted from the response (analysis discarded).
4. The summary is returned as pi's compaction result — `firstKeptEntryId` and
   `tokensBefore` are passed through unchanged from pi's preparation.

## Configuration

### Model selection

By default, the **current conversation model** is used (matching Claude Code,
which summarizes with its `mainLoopModel`). Override with an env var:

```bash
# Cheap/fast summarization with Gemini Flash
export PI_CC_COMPACT_MODEL="google/gemini-2.5-flash"

# Or any provider/model id registered in your models.json
export PI_CC_COMPACT_MODEL="anthropic/claude-haiku-4"
```

Format: `provider/modelId`. If unset or malformed, the conversation model is used.

### Max output tokens

Hard-set to **20000**, mirroring Claude Code's `maxOutputTokensOverride`. This is
intentional — the 9-section summary needs the room. (Not currently configurable.)

### `/compact [instructions]`

Custom instructions passed to `/compact` are honored as `Additional Instructions:`,
exactly like Claude Code's PreCompact-hook integration.

## Behavior on failure

If the model call fails, returns empty, or has no API key, the extension **falls
back to pi's default compaction** silently (with a warning). Your session is never
left without a summary.

## Notes & caveats

- **Extended thinking:** Claude Code disables thinking during compaction. This
  extension does not currently disable it (depends on provider support in the
  `complete()` call). On thinking-capable models the summary may cost more tokens.
- **Tool results** are truncated to 2000 chars by pi's `serializeConversation`
  before this extension ever sees them — same budget Claude Code effectively works
  within.
- **Not affiliated with Anthropic.** The prompt text is reconstructed from public
  leaks for interoperability. "Claude Code" is a trademark of Anthropic.

## Uninstall

```bash
pi remove npm:pi-cc-compact
```

## License

MIT
