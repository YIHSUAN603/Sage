// S4.5 — Chat store: message history, streaming flag, in-flight partial text
// and the AbortController behind the composer's stop button.
import { create } from "zustand";
import i18n from "../i18n/index.ts";
import type { ChatMessage, SkillMeta } from "../ipc/contract.ts";
import {
  createAgentCliBackend,
  createOpenRouterBackend,
  type ChatBackend,
} from "../llm/backend.ts";
import { AgentLoopError } from "../llm/loop.ts";
import { buildContextMessage } from "../observe/context.ts";
import { createReadFileTool } from "../tools/readFile.ts";
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
  /** A clicked proactive bubble becomes the assistant's opening line (no LLM call). */
  openFromBubble: (text: string) => void;
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
    const settings = useSettingsStore.getState().settings;
    const useAgentCli = settings.backend === "agent_cli";
    const model = settings.chat_model.trim();
    // Agent-CLI backends need no OpenRouter model — the CLI brings its own.
    if (!useAgentCli && !model) {
      set({ error: i18n.t("errors.noChatModel") });
      return;
    }
    const messages: ChatMessage[] = [
      ...get().messages,
      { role: "user", content: trimmed },
    ];
    const abort = new AbortController();
    set({ messages, streaming: true, partial: "", error: null, abort });

    // S5.4 — 觀察開啟時，把最近的視窗脈絡以 system message 注入「這次請求」，
    // 但不進 store.messages（對話歷史保持乾淨，UI 本來也不渲染 system）。
    // 換夥伴後，同樣以 request-only system 注入夥伴人格（沒選夥伴時為 null，維持現況）。
    const persona = await chatPersonaSystem();
    const observed = settings.observe_enabled
      ? buildContextMessage(useObservationStore.getState().recent, Date.now())
      : null;
    const prefix: ChatMessage[] = [];
    if (persona) prefix.push({ role: "system", content: persona });
    if (observed) prefix.push(observed);
    const requestMessages = prefix.length > 0 ? [...prefix, ...messages] : messages;

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

  openFromBubble(text) {
    const trimmed = text.trim();
    if (!trimmed || get().streaming) return;
    set((state) => ({
      messages: [...state.messages, { role: "assistant", content: trimmed }],
      error: null,
    }));
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
      return i18n.t("errors.auth");
    case "rate_limit":
      return i18n.t("errors.rateLimit");
    case "network":
      return i18n.t("errors.network", { message: error.message });
    default:
      return error.message;
  }
}
