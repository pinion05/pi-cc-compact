// Build the experiment corpus: serialize the current session like pi's compaction sees it.
import { readFileSync } from "node:fs";
import { convertToLlm, serializeConversation } from "@earendil-works/pi-coding-agent";

const SESSION = "/Users/pinion/.pi/agent/sessions/--Users-pinion-dev-jaroo-mvp-v3--/2026-06-30T01-34-14-693Z_019f1629-a0a5-7edf-bca1-3e5c2d490898.jsonl";

const raw = readFileSync(SESSION, "utf8").split("\n").filter(Boolean).map(l => {
  try { return JSON.parse(l); } catch { return null; }
}).filter(Boolean);

// Extract message entries exactly like compaction does
const messages = [];
for (const e of raw) {
  if (e.type === "message" && e.message) messages.push(e.message);
}
console.error(`[corpus] ${messages.length} messages from ${raw.length} entries`);

// Convert + serialize (same path as pi compaction)
const llm = convertToLlm(messages);
const text = serializeConversation(llm);

// Token estimate (~4 chars/token)
const estTokens = Math.round(text.length / 4);
console.error(`[corpus] serialized: ${text.length} chars ≈ ${estTokens} tokens`);

console.log(text);
