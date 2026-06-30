# pi-cc-compact
<img width="1672" height="941" alt="ChatGPT Image 2026년 6월 30일 오후 01_39_14" src="https://github.com/user-attachments/assets/bf0bf1e1-20b6-412f-9bc3-d59397dfe0c1" />

[![npm version](https://img.shields.io/npm/v/pi-cc-compact?color=cb3837)](https://www.npmjs.com/package/pi-cc-compact) [![npm downloads](https://img.shields.io/npm/dm/pi-cc-compact?color=cb3837)](https://www.npmjs.com/package/pi-cc-compact) [![GitHub](https://img.shields.io/badge/GitHub-pinion05%2Fpi--cc--compact-181717?logo=github)](https://github.com/pinion05/pi-cc-compact) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

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

## Does it actually help? — A/B benchmark

Yes — measured head-to-head against pi's default compaction on the **exact same
session** that produced this package, on the **same model**, across **10 interleaved
trials each**. Full methodology and raw data: [`exp/`](./exp) and
[`exp/RESULTS.md`](./exp/RESULTS.md).

### Setup

| Knob | Value |
|---|---|
| Corpus | the session that built this package (153 messages, ~78k tokens serialized) |
| Model | `zai/glm-4.7` (free, 204k ctx) — **identical for both arms** |
| maxTokens | 20000 (Claude Code's override), both arms |
| Trials | 20 calls total (10 pi + 10 cc), shuffled, concurrency 5 |
| Prompts | extracted verbatim from each tool's source |

### Headline results (10/10 OK on both arms)

| Metric | pi-default | Claude-Code | Δ |
|---|---|---|---|
| Output length | 5,183 chars (1,296 tok) | 11,766 chars (2,942 tok) | **CC 2.27× longer** |
| Latency (all trials) | 93 s ± 45 s | 135 s ± 27 s | see below |
| Length variance (CV) | 13 % | 25 % | CC less predictable |
| Section coverage | 100 % (6/6) | 100 % (9/9) | tie |
| `<analysis>`/`<summary>` tags | n/a | 10/10 | perfect compliance |
| **Avg entity recall** | 8.3 / 10 | **10.0 / 10** | **CC perfect** |

#### A note on latency (honest accounting)

The headline latency ratio depends heavily on how outliers are handled:

| Method | pi-default | Claude-Code | Ratio |
|---|---|---|---|
| All trials (n=10) | 93 s ± 45 s (range 54–168 s) | 135 s ± 27 s (range 100–190 s) | **1.45×** |
| Drop 3 slowest each (n=7) | 63 s | 120 s | **1.89×** |

pi's distribution is bimodal — three trials hit 158–168 s (likely cold/rate-limited
starts) while the other seven cluster at 54–72 s. Including those outliers inflates
pi's mean and makes CC look relatively faster. Trimming them, CC is closer to
**~1.9× slower**. Treat 1.45× as the optimistic bound and ~1.9× as the typical case.
Note also that on reasoning-capable models, hidden thinking tokens add cost not
captured by output length or wall-clock latency.

### The real differentiator — entity recall

How often each key fact from the session survived compaction (out of 10 runs):

| Entity | pi-default | Claude-Code |
|---|---|---|
| pi-cc-compact (this pkg) | 10/10 | 10/10 |
| Claude Code | 10/10 | 10/10 |
| `session_before_compact` hook | 10/10 | 10/10 |
| 9-section / analysis format | 10/10 | 10/10 |
| leak source (v2.1.68) | 10/10 | 10/10 |
| GitHub publish step | 10/10 | 10/10 |
| `extensions/index.ts` (file) | 8/10 | **10/10** |
| OpenRouter (tried earlier) | 7/10 | **10/10** |
| 패키지 / Korean topic | 6/10 | **10/10** |
| **Hypa (the suspect pkg investigated)** | **2/10** | **10/10** |

CC captures **every** entity in **every** run. pi-default silently drops long-tail
detail — most strikingly, the entire Hypa investigation (a major subplot of the
session) survived only 20 % of the time under pi's terse format.

### Caveats — read this before trusting the numbers

The benchmark above is honest (raw data in `exp/results.json`, recomputed numbers
match) but **narrow**. Before concluding CC is objectively better, note:

- **Self-referential corpus.** The only corpus tested is *the session that built
  this package* — a CC-themed session. The entity list (Hypa, `extensions/index.ts`,
  leak, ...) is drawn from that session. CC's prompt *forces* listing "all user
  messages" and "files and code sections," so tokens that appear only in user
  messages or file paths are structurally preserved by CC. On a CC-themed corpus,
  "CC recalls CC-keywords better" is close to tautological.
- **Surface-keyword proxy, not task performance.** "Entity recall" measures whether
  a string appears in the summary, not whether the post-compaction agent actually
  resumes work more successfully. A verbose summary wins keyword tests by
  construction. Downstream task-success / error-rate was never measured.
- **Single model.** Only `zai/glm-4.7`. Verbosity and instruction-following vary
  across models (Claude, GPT, Gemini); results may flip elsewhere.
- **Single corpus, n=10.** Not enough to generalize across session types (debugging,
  feature work, multi-file refactors) or to rule out model-specific artifacts.

**Bottom line:** this benchmark demonstrates that *the CC format produces more
verbose, more keyword-complete summaries at higher cost* — which is largely the
expected consequence of the prompt design, not a discovery. It does **not** prove
CC yields better real-world task continuity. Treat it as a format/cost tradeoff
characterization, not a quality verdict.

### Verdict

CC trades **2.3× post-compaction context cost** and **~1.45–1.9× latency**
(optimistic–typical) for more verbose, keyword-complete summaries. Both prompts are
structurally perfect. So:

- If you want a **lean, fast checkpoint** → keep pi's default.
- If you want a **verbose, near-lossless carry-forward** across compactions and
  accept the cost → install `pi-cc-compact`.

Best for long, complex sessions where losing "what we already figured out" hurts
more than the extra tokens.

### Reproduce

```bash
git clone https://github.com/pinion05/pi-cc-compact
cd pi-cc-compact
node exp/load_corpus.mjs > exp/corpus.txt   # regenerate corpus from a session
node exp/run.mjs                              # ~10 min, 20 LLM calls
```

`exp/corpus.txt` is git-ignored (it's a serialized personal session); regenerate it
by pointing `load_corpus.mjs` at any `.jsonl` session file.

---

## Why

Pi's default compaction summary follows pi's own `## Goal / ## Progress / ...`
format — a concise checklist. Some users prefer the denser, intent-preserving style
Claude Code uses, in particular its insistence on listing **all user messages** and
the **verbatim last task** so intent doesn't drift across compactions. This package
gives you that style without leaving pi.

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
