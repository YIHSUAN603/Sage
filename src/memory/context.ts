// Build the system message that injects the long-term memory index into a chat
// request. Pure function: the chat store passes the saved memories' metadata;
// returns null when there is nothing remembered. Mirrors observe/context.ts's
// buildContextMessage — the message goes into the request only (never into the
// visible history; MessageList hides role:"system").
//
// CRITICAL: this carries only the index — each memory's name + one-line
// description. A memory's full body NEVER rides here; it loads on demand via
// the recall_memory tool (tools/recallMemory.ts).
import i18n from "../i18n/index.ts";
import type { ChatMessage, MemoryMeta } from "../ipc/contract.ts";

export function buildMemoryIndexMessage(
  memories: MemoryMeta[],
): ChatMessage | null {
  if (memories.length === 0) return null;

  const lines = memories.map((m) => `- ${m.name}: ${m.description}`);

  const intro = i18n.t("memory.index.intro", { ns: "prompt" });

  return {
    role: "system",
    content: [intro, lines.join("\n")].join("\n"),
  };
}
