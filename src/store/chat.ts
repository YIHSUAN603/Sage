// S4.5 — Chat store: message history, streaming flag, in-flight partial text
// and the AbortController behind the composer's stop button.
import { create } from "zustand";
import type { ChatMessage } from "../ipc/contract.ts";
import { AgentLoopError, runAgentLoop } from "../llm/loop.ts";
import { createReadFileTool } from "../tools/readFile.ts";
import { createToolRegistry } from "../tools/registry.ts";
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
    const model = useSettingsStore.getState().settings.chat_model.trim();
    if (!model) {
      set({
        error:
          "尚未選擇聊天模型——請開啟設定（⚙），在「聊天模型」挑一個或填入 OpenRouter model id。",
      });
      return;
    }
    const messages: ChatMessage[] = [
      ...get().messages,
      { role: "user", content: trimmed },
    ];
    const abort = new AbortController();
    set({ messages, streaming: true, partial: "", error: null, abort });

    // runAgentLoop 處理整個 function-calling 迴圈：串流→有 tool_calls 就查
    // registry 執行→回填 role:"tool"→續跑至收斂。onMessage 讓每則 assistant
    // / tool 訊息一落地就進 UI（工具卡片即時出現），onDelta 驅動串流游標。
    const registry = createToolRegistry([createReadFileTool(ipc)]);
    let partial = "";

    try {
      await runAgentLoop({
        ipc,
        model,
        messages,
        tools: registry,
        signal: abort.signal,
        onDelta(text) {
          partial += text;
          set({ partial });
        },
        onMessage(message) {
          partial = "";
          set((state) => ({
            messages: [...state.messages, message],
            partial: "",
          }));
        },
      });
    } catch (err) {
      if (!abort.signal.aborted) {
        set({
          error:
            err instanceof AgentLoopError
              ? describeStreamError(err)
              : err instanceof Error
                ? err.message
                : String(err),
        });
      }
    } finally {
      set({ streaming: false, abort: null, partial: "" });
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

function describeStreamError(error: AgentLoopError): string {
  switch (error.kind) {
    case "auth":
      return "API key 無效或未授權（401）——請到設定檢查 OpenRouter key。";
    case "rate_limit":
      return "額度或速率已達上限（429）——休息一下再試。";
    case "network":
      return `網路連線失敗：${error.message}`;
    default:
      return error.message;
  }
}
