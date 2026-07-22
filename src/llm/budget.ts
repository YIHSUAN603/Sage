// Trim conversation history to a character budget before it rides into a chat
// request. Persistence (Track A) keeps the whole conversation on disk; this
// bounds what actually travels to the model each turn — keep the NEWEST
// messages that fit, drop older ones from the front.
//
// Two invariants make the trimmed history still valid:
//   (a) Tool-call groups stay intact. An assistant message carrying tool_calls
//       plus every following role:"tool" message answering it form one unit —
//       included or excluded as a whole. We never return a role:"tool" message
//       whose owning assistant was dropped (the API rejects an orphaned tool
//       result).
//   (b) The last user turn is always kept, even if it alone blows the budget —
//       otherwise there'd be nothing to respond to.
//
// Callers pass only the base history (user/assistant/tool). The system prefix
// (persona, memory index, observation context) is assembled elsewhere and is
// never part of the input here.
import type { ChatMessage } from "../ipc/contract.ts";

/** Rough character budget for history sent per request (~a few k tokens). */
export const HISTORY_BUDGET_CHARS = 24_000;

/** Character cost of one message's content (tool_calls metadata is cheap and ignored). */
function contentLength(message: ChatMessage): number {
  const content = message.content;
  if (content == null) return 0;
  if (typeof content === "string") return content.length;
  // ContentPart[] (mixed text/images) — stringify so image data URLs count too.
  return JSON.stringify(content).length;
}

export function truncateHistory(
  messages: ChatMessage[],
  maxChars: number = HISTORY_BUDGET_CHARS,
): ChatMessage[] {
  if (messages.length === 0) return [];

  // Always keep the newest message, then walk backward including older ones
  // while the cumulative content length still fits.
  let start = messages.length - 1;
  let total = contentLength(messages[start]);
  for (let i = messages.length - 2; i >= 0; i--) {
    const len = contentLength(messages[i]);
    if (total + len > maxChars) break;
    total += len;
    start = i;
  }

  // Invariant (b): never cut into the last user turn — pull `start` back to the
  // last user message if the budget stopped short of it.
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      if (i < start) start = i;
      break;
    }
  }

  // Invariant (a): if the kept slice now begins with role:"tool" messages, their
  // owning assistant sits before `start` and was dropped — drop the orphaned
  // tool messages too (the whole leading block).
  while (start < messages.length && messages[start].role === "tool") {
    start += 1;
  }

  return messages.slice(start);
}
