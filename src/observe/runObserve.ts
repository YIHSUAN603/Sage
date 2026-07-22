// One observation turn, routed to whichever backend is active. The bubble gate
// builds the messages (system + recent-activity + semantic-snapshot text) —
// always plain text, no images — and this decides how to get a reply out of
// them. Settings are read at call time via `getSettings`, so switching backend
// takes effect on the next ask.
import type { ChatMessage, ChatRequest, SageIpc, Settings } from "../ipc/contract.ts";
import { createDeltaAccumulator } from "../llm/openrouter.ts";

export type RunObserve = (
  messages: ChatMessage[],
  debug?: (message: string) => void,
) => Promise<string | null>;

export function createRunObserve(
  ipc: SageIpc,
  getSettings: () => Settings,
): RunObserve {
  return async (messages, debug = () => {}) => {
    const s = getSettings();
    if (s.backend === "agent_cli") {
      return observeViaAgentCli(ipc, s.agent_cli, s.agent_cli_model, messages, debug);
    }
    const model = (s.observe_model.trim() || s.chat_model).trim();
    return observeViaOpenRouter(ipc, model, messages, s.observe_deny_data_collection, debug);
  };
}

async function observeViaOpenRouter(
  ipc: SageIpc,
  model: string,
  messages: ChatMessage[],
  deny: boolean,
  debug: (m: string) => void,
): Promise<string | null> {
  if (!model) {
    debug("沒有可用的模型（觀察/聊天模型都未設定）");
    return null; // nothing configured — never burn an error on the user
  }

  const req: ChatRequest = { model, messages };
  if (deny) req.data_policy = "deny";
  const acc = createDeltaAccumulator();
  let finished;
  try {
    await ipc.chatStream(req, (event) => acc.push(event));
    finished = acc.finish();
  } catch (err) {
    debug(`chat_stream 呼叫失敗：${message(err)}`);
    return null;
  }

  const { message: reply, error } = finished;
  if (error) {
    debug(`串流回報錯誤：${error.kind}${error.status ? ` (${error.status})` : ""} — ${error.message}`);
    return null;
  }
  return typeof reply.content === "string" ? reply.content : "";
}

async function observeViaAgentCli(
  ipc: SageIpc,
  cli: Settings["agent_cli"],
  model: string,
  messages: ChatMessage[],
  debug: (m: string) => void,
): Promise<string | null> {
  let text = "";
  let errored: string | null = null;
  try {
    await ipc.agentStream({ cli, messages, purpose: "observe", model }, (event) => {
      if (event.type === "delta") text += event.content;
      else if (event.type === "error") errored = event.message;
    });
  } catch (err) {
    debug(`agent_stream 呼叫失敗：${message(err)}`);
    return null;
  }
  if (errored) {
    debug(`agent CLI 回報錯誤：${errored}`);
    return null;
  }
  return text;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
