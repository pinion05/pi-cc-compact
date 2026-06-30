---
name: cc-compact
description: Use when the user asks about pi compaction, how this package works, how to configure the compaction model, or wants to compare pi-cc-compact with Claude Code's native compaction. Covers the session_before_compact hook, the 9-section analysis+summary prompt, PI_CC_COMPACT_MODEL override, and fallback behavior.
---

# pi-cc-compact — Claude Code compaction prompt for pi

This package ports Anthropic's Claude Code full-compaction prompt to pi.

## What it does

Hooks `session_before_compact`, serializes the messages being compacted, sends them
to the model with the reconstructed 9-section `<analysis>` + `<summary>` prompt,
extracts the `<summary>` block, and returns it as pi's compaction result.

## Key facts

- Prompt source: leaked/deobfuscated `compact_service` from `@anthropic-ai/claude-code` v2.1.68.
- Default model: current conversation model (`ctx.model`). Override: `PI_CC_COMPACT_MODEL="provider/modelId"`.
- Max output: 20000 tokens (Claude Code's hard override).
- Only `<summary>` stored; `<analysis>` scratchpad discarded (mirrors `formatCompactSummary()`).
- Falls back to pi default compaction on any error / empty result / missing key.
- Honors `/compact [instructions]` as `Additional Instructions:`.

## Install / configure

```bash
pi install npm:pi-cc-compact
export PI_CC_COMPACT_MODEL="google/gemini-2.5-flash"   # optional
```

## Troubleshooting

- "No API key for compaction model" → set the provider key in pi auth, or unset `PI_CC_COMPACT_MODEL` to use the conversation model.
- Summary feels too short → ensure the model isn't truncating at a low output limit; 20000 tokens is reserved.
