# A/B Compaction Experiment: pi-default vs Claude-Code prompt

Same corpus · same model · 10 interleaved trials each.

## Setup

- **Corpus**: the current session itself (`2026-06-30T01-34-14...jsonl`, 153 messages,
  serialized via pi's `serializeConversation` → ~78k tokens).
- **Model**: `zai/glm-4.7` (free, 204k context) — identical for both arms.
- **Prompts**: extracted verbatim.
  - pi-default: `SUMMARIZATION_PROMPT` + `SUMMARIZATION_SYSTEM_PROMPT` from pi's
    `dist/core/compaction/{compaction,utils}.js`.
  - CC: reconstructed `compact_service` prompt (9-section `<analysis>`+`<summary>`).
- **maxTokens**: 20000 (Claude Code's override) for both.
- **Trials**: 20 calls total (10 pi + 10 cc), shuffled, run in a concurrency-5 pool.

## Reproduce

```bash
cd pi-cc-compact
node exp/load_corpus.mjs > exp/corpus.txt      # one-time
node exp/run.mjs                                # ~10 min, prints summary
```

## Results (10/10 OK both arms)

### Headline

| Metric | pi-default | Claude-Code | Δ |
|---|---|---|---|
| Output length (chars) | 5,183 ± 690 | 11,766 ± 2,889 | **CC 2.27× longer** |
| ≈ tokens | 1,296 | 2,942 | +1,646 tok |
| Latency | 93s | 135s | **CC 1.45× slower** |
| Length CV (variance) | 13% | 25% | CC less predictable |
| Section coverage | 100% (6/6) | 100% (9/9) | tie |
| `<analysis>`/`<summary>` tags | n/a | 10/10 | — |
| Avg entity recall | 8.3 / 10 | **10.0 / 10** | CC perfect |

### Entity recall (the real differentiator)

| Entity | pi | CC |
|---|---|---|
| pi-cc-compact (built pkg) | 10/10 | 10/10 |
| Claude Code | 10/10 | 10/10 |
| session_before_compact | 10/10 | 10/10 |
| 9-section/analysis format | 10/10 | 10/10 |
| leak source | 10/10 | 10/10 |
| GitHub publish | 10/10 | 10/10 |
| extensions/index.ts (file) | 8/10 | **10/10** |
| OpenRouter (tried) | 7/10 | **10/10** |
| 패키지/KR topic | 6/10 | **10/10** |
| **Hypa (suspect pkg)** | **2/10** | **10/10** |

CC captures **every** entity every run. pi-default drops detail — most strikingly the
Hypa investigation (a major subplot of this session) was preserved only 20% of the time.

## Verdict

CC trades **2.3× post-compaction context cost** and **1.45× latency** for materially
better recall (notably the long-tail details pi's terse format omits). Both are
structurally perfect. Choice depends on whether you prioritize a lean, fast
checkpoint (pi) or a faithful, lossless carry-forward (CC).
