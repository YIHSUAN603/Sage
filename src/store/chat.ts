// S4.5 — Chat store: message history, streaming flag, in-flight partial text
// and the AbortController behind the composer's stop button.
import { create } from "zustand";
import type { ChatMessage, StreamEvent, ToolCall } from "../ipc/contract.ts";
import { requireIpc } from "./ipc.ts";
import { useSettingsStore } from "./settings.ts";

/** Avatar animation state, derived from streaming progress. */
export type AvatarMood = "idle" | "thinking" | "talking";

/** Cross-window Tauri event carrying an AvatarMood payload (chat → avatar). */
export const MOOD_EVENT = "sage:mood";

export interface ChatState {
  messages: ChatMessage[];
  streaming: boolean;
  /** Partial assistant text of the in-flight stream (empty when idle). */
  partial: string;
  error: string | null;
  abort: AbortController | null;
  send: (text: string) => Promise<void>;
  stop: () => void;
  clearError: () => void;
  clear: () => void;
}

export const useChatStore = create<ChatState>()((set, get) => ({
  messages: [],
  streaming: false,
  partial: "",
  error: null,
  abort: null,

  async send(text) {
    const trimmed = text.trim();
    if (!trimmed || get().streaming) return;

    const ipc = requireIpc();
    const model = useSettingsStore.getState().settings.chat_model;
    const messages: ChatMessage[] = [
      ...get().messages,
      { role: "user", content: trimmed },
    ];
    const abort = new AbortController();
    set({ messages, streaming: true, partial: "", error: null, abort });

    // TODO(T2 整合): 把下面這段直接 chatStream 換成 runAgentLoop()
    // （src/llm/loop.ts, S2.3）——由迴圈處理 tool_calls → registry 執行 →
    // 回填 role:"tool" → 續跑至收斂。目前先用 chatStream + 簡單 delta 累積
    // 讓純聊天可動；tool_calls 只累積並顯示卡片，不會實際執行。
    let content = "";
    const toolParts = new Map<number, { id: string; name: string; args: string }>();

    const onEvent = (event: StreamEvent) => {
      if (event.type === "delta") {
        if (event.content) {
          content += event.content;
          set({ partial: content });
        }
        for (const tc of event.tool_calls ?? []) {
          const slot = toolParts.get(tc.index) ?? { id: "", name: "", args: "" };
          if (tc.id) slot.id = tc.id;
          if (tc.function?.name) slot.name = tc.function.name;
          if (tc.function?.arguments) slot.args += tc.function.arguments;
          toolParts.set(tc.index, slot);
        }
      } else if (event.type === "error") {
        set({ error: describeStreamError(event) });
      }
    };

    try {
      await ipc.chatStream({ model, messages }, onEvent, abort.signal);
    } catch (err) {
      if (!abort.signal.aborted) {
        set({ error: err instanceof Error ? err.message : String(err) });
      }
    } finally {
      const toolCalls: ToolCall[] = [...toolParts.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, part]) => ({
          id: part.id,
          type: "function" as const,
          function: { name: part.name, arguments: part.args },
        }));
      const assistant: ChatMessage | null =
        content || toolCalls.length > 0
          ? {
              role: "assistant",
              content: content || null,
              ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
            }
          : null;
      set((state) => ({
        streaming: false,
        abort: null,
        partial: "",
        messages: assistant ? [...state.messages, assistant] : state.messages,
      }));
    }
  },

  stop() {
    get().abort?.abort();
  },

  clearError() {
    set({ error: null });
  },

  clear() {
    get().abort?.abort();
    set({ messages: [], partial: "", error: null });
  },
}));

/** Selector: what should the avatar be doing right now? */
export function avatarMood(state: ChatState): AvatarMood {
  if (!state.streaming) return "idle";
  return state.partial ? "talking" : "thinking";
}

function describeStreamError(
  event: Extract<StreamEvent, { type: "error" }>,
): string {
  switch (event.kind) {
    case "auth":
      return "API key 無效或未授權（401）——請到設定檢查 OpenRouter key。";
    case "rate_limit":
      return "額度或速率已達上限（429）——休息一下再試。";
    case "network":
      return `網路連線失敗：${event.message}`;
    default:
      return event.message;
  }
}
