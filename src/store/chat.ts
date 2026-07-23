// S4.5 — Chat store: message history, streaming flag, in-flight partial text
// and the AbortController behind the composer's stop button.
import { create } from "zustand";
import i18n from "../i18n/index.ts";
import type { ChatMessage, MemoryMeta, SkillMeta } from "../ipc/contract.ts";
import {
  createAgentCliBackend,
  createOpenRouterBackend,
  type ChatBackend,
} from "../llm/backend.ts";
import { truncateHistory } from "../llm/budget.ts";
import { AgentLoopError } from "../llm/loop.ts";
import { buildMemoryIndexMessage } from "../memory/context.ts";
import { buildContextMessage } from "../observe/context.ts";
import { createForgetMemoryTool } from "../tools/forgetMemory.ts";
import { createReadFileTool } from "../tools/readFile.ts";
import { createRecallMemoryTool } from "../tools/recallMemory.ts";
import { createSaveMemoryTool } from "../tools/saveMemory.ts";
import { createToolRegistry } from "../tools/registry.ts";
import { createSkillTool } from "../tools/useSkill.ts";
import { chatPersonaSystem } from "./persona.ts";
import { requireIpc } from "./ipc.ts";
import { useObservationStore } from "./observation.ts";
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
  /**
   * Drop everything after the last user message (the previous answer, tool
   * cards included) and run that turn again. No-op mid-stream or when the
   * history holds no user message (e.g. only a bubble opener).
   */
  regenerate: () => Promise<void>;
  /** Load the persisted conversation on startup (no-op mid-stream). */
  hydrate: () => Promise<void>;
  /** A clicked proactive bubble becomes the assistant's opening line (no LLM call). */
  openFromBubble: (text: string) => void;
  stop: () => void;
  clearError: () => void;
  clear: () => Promise<void>;
}

export const useChatStore = create<ChatState>()((set, get) => {
  // 一輪對話的主體（send / regenerate 共用）：驗證設定 → 組 request →
  // 串流 → 錯誤處理 → finally 持久化。`messages` 是這輪的完整可見歷史
  // （已含最後一則 user 訊息），驗證通過後才寫進 store。
  async function runTurn(messages: ChatMessage[]): Promise<void> {
    const ipc = requireIpc();
    const settings = useSettingsStore.getState().settings;
    const useAgentCli = settings.backend === "agent_cli";
    const model = settings.chat_model.trim();
    // Agent-CLI backends need no OpenRouter model — the CLI brings its own.
    if (!useAgentCli && !model) {
      set({ error: i18n.t("errors.noChatModel") });
      return;
    }
    const abort = new AbortController();
    set({ messages, streaming: true, partial: "", error: null, abort });

    // 0.4 — 長期記憶：只有開啟時才撈。輕量索引（名稱＋一句摘要）會隨每次請求
    // 注入（兩種後端都吃），完整內容則靠 recall_memory 工具按需載入（只掛在
    // OpenRouter registry 上）。撈不到就當沒有，聊天照常。
    let memories: MemoryMeta[] = [];
    if (settings.memory_enabled) {
      try {
        memories = await ipc.listMemories();
      } catch {
        memories = [];
      }
    }

    // S5.4 — 觀察開啟時，把最近的視窗脈絡以 system message 注入「這次請求」，
    // 但不進 store.messages（對話歷史保持乾淨，UI 本來也不渲染 system）。
    // 換夥伴後，同樣以 request-only system 注入夥伴人格（沒選夥伴時為 null，維持現況）。
    // 記憶索引同屬 request-only system，且排在觀察脈絡之前。
    const persona = await chatPersonaSystem();
    const observed = settings.observe_enabled
      ? buildContextMessage(useObservationStore.getState().recent, Date.now())
      : null;
    const memoryIndex = settings.memory_enabled
      ? buildMemoryIndexMessage(memories)
      : null;
    const prefix: ChatMessage[] = [];
    if (persona) prefix.push({ role: "system", content: persona });
    if (memoryIndex) prefix.push(memoryIndex);
    if (observed) prefix.push(observed);
    // 對話歷史送出前先照字元預算尾端截斷（保留最新、丟最舊）：系統前綴不算在
    // 預算內、永遠置頂。持久化保留完整對話在磁碟，這裡只約束「這次上模型」的量。
    // `ts` 是 UI 專用欄位，送模型前一律剝除。
    const bounded = truncateHistory(messages).map(
      ({ ts: _ts, ...message }) => message as ChatMessage,
    );
    const requestMessages = prefix.length > 0 ? [...prefix, ...bounded] : bounded;

    // runAgentLoop 處理整個 function-calling 迴圈：串流→有 tool_calls 就查
    // registry 執行→回填 role:"tool"→續跑至收斂。onMessage 讓每則 assistant
    // / tool 訊息一落地就進 UI（工具卡片即時出現），onDelta 驅動串流游標。
    // Skill 目錄每次 send 重掃（本地 fs，很便宜）：丟新 skill 進資料夾立即生效；
    // 掃描失敗只代表這輪沒有 use_skill 工具，聊天照常。
    let backend: ChatBackend;
    if (useAgentCli) {
      // The CLI runs its own read-only tool loop and skills; Sage's registry
      // (read_file / use_skill) is only wired to the OpenRouter backend.
      backend = createAgentCliBackend(ipc, settings.agent_cli, settings.agent_cli_model, "chat");
    } else {
      let skills: SkillMeta[] = [];
      try {
        skills = await ipc.listSkills();
      } catch {
        skills = [];
      }
      const registry = createToolRegistry([
        createReadFileTool(ipc),
        ...(skills.length > 0 ? [createSkillTool(ipc, skills)] : []),
        // 記憶工具只掛 OpenRouter 後端：agent-CLI 只吃索引注入，不給 Sage 工具。
        ...(settings.memory_enabled
          ? [
              createRecallMemoryTool(ipc, memories),
              createSaveMemoryTool(ipc),
              createForgetMemoryTool(ipc, memories),
            ]
          : []),
      ]);
      backend = createOpenRouterBackend(ipc, model, registry);
    }
    let partial = "";

    try {
      await backend.runTurn({
        messages: requestMessages,
        signal: abort.signal,
        onDelta(text) {
          partial += text;
          set({ partial });
        },
        onMessage(message) {
          partial = "";
          set((state) => ({
            messages: [...state.messages, { ...message, ts: Date.now() }],
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
      // 這一輪的 assistant/tool 訊息都落地後，把可見歷史寫回磁碟。射後不理：
      // 寫檔失敗不該冒成聊天錯誤，也不擋 UI。
      void requireIpc().saveSession(get().messages);
    }
  }

  return {
    messages: [],
    streaming: false,
    partial: "",
    error: null,
    abort: null,

    async send(text) {
      const trimmed = text.trim();
      if (!trimmed || get().streaming) return;
      await runTurn([
        ...get().messages,
        { role: "user", content: trimmed, ts: Date.now() },
      ]);
    },

    async regenerate() {
      if (get().streaming) return;
      const messages = get().messages;
      // 找最後一則 user 訊息；其後的 assistant/tool 訊息全部丟掉重跑。
      let last = -1;
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "user") {
          last = i;
          break;
        }
      }
      if (last < 0) return;
      await runTurn(messages.slice(0, last + 1));
    },

    async hydrate() {
      // 啟動時載入已持久化的對話。串流中不覆寫（也順帶擋掉 React strict-mode
      // 的雙掛載重跑）；沒有存檔或載入失敗就維持空歷史。
      if (get().streaming) return;
      try {
        const messages = await requireIpc().loadSession();
        set({ messages });
      } catch {
        // 沒有存檔（或指令尚未接上）——保持空的。
      }
    },

    openFromBubble(text) {
      const trimmed = text.trim();
      if (!trimmed || get().streaming) return;
      set((state) => ({
        messages: [
          ...state.messages,
          { role: "assistant", content: trimmed, ts: Date.now() },
        ],
        error: null,
      }));
      // 被點開的冒泡也成了對話的一部分——一併持久化（射後不理）。
      void requireIpc().saveSession(get().messages);
    },

    stop() {
      get().abort?.abort();
    },

    clearError() {
      set({ error: null });
    },

    async clear() {
      // 先中止進行中的串流，再把目前對話歸檔後清空——「清除」不是銷毀歷史，
      // 而是把它收進封存（設定裡可瀏覽／刪除）。歸檔失敗仍照常清空 UI。
      get().abort?.abort();
      try {
        await requireIpc().archiveSession();
      } catch {
        // 沒東西可歸檔（或指令尚未接上）——照樣清空。
      }
      set({ messages: [], partial: "", error: null });
      void requireIpc().saveSession([]);
    },
  };
});

/** Selector: what should the avatar be doing right now? */
export function avatarMood(state: ChatState): AvatarMood {
  if (!state.streaming) return "idle";
  return state.partial ? "talking" : "thinking";
}

function describeStreamError(error: AgentLoopError): string {
  switch (error.kind) {
    case "auth":
      return i18n.t("errors.auth");
    case "rate_limit":
      return i18n.t("errors.rateLimit");
    case "network":
      return i18n.t("errors.network", { message: error.message });
    default:
      return error.message;
  }
}
