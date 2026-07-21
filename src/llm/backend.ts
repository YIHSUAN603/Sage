// One turn of conversation, abstracted over where the tokens come from.
// - OpenRouter: Sage owns the function-calling loop (runAgentLoop) + its own
//   read_file/use_skill tools.
// - Agent CLI (claude / codex): the CLI owns its loop and read-only tools; we
//   just translate its AgentStreamEvent stream into the same ChatMessages the
//   UI already renders. store/chat.ts and observe pick a backend by settings.
import type { AgentRequest, ChatMessage, SageIpc } from "../ipc/contract.ts";
import type { ToolRegistry } from "../tools/registry.ts";
import { AgentLoopError, runAgentLoop } from "./loop.ts";

export interface ChatTurn {
  /** Full conversation to send (system prefix already applied by the caller). */
  messages: ChatMessage[];
  /** Each streamed text fragment, for the live cursor. */
  onDelta(text: string): void;
  /** Each finalized assistant / tool message, as it lands in the history. */
  onMessage(message: ChatMessage): void;
  signal?: AbortSignal;
}

export interface ChatBackend {
  runTurn(turn: ChatTurn): Promise<void>;
}

/** OpenRouter: delegate to the existing agent loop unchanged. */
export function createOpenRouterBackend(
  ipc: SageIpc,
  model: string,
  tools: ToolRegistry,
): ChatBackend {
  return {
    async runTurn({ messages, onDelta, onMessage, signal }) {
      await runAgentLoop({ ipc, model, messages, tools, onDelta, onMessage, signal });
    },
  };
}

/** Local agent CLI: stream from `agent_stream`, synthesizing UI messages. */
export function createAgentCliBackend(
  ipc: SageIpc,
  cli: AgentRequest["cli"],
  model: string,
  purpose: AgentRequest["purpose"],
): ChatBackend {
  return {
    async runTurn({ messages, onDelta, onMessage, signal }) {
      // Text before a tool call becomes that assistant message's bubble; the
      // tool call rides along as tool_calls; results arrive as role:"tool".
      let pending = "";
      // The CLI runs its own loop, so an "error" event is terminal but arrives
      // mid-stream; capture it and throw after the stream settles (a throw inside
      // the event callback wouldn't reject the real IPC's invoke promise).
      let captured: { kind: AgentLoopError["kind"]; message: string } | null = null;

      const flushText = () => {
        if (pending) {
          onMessage({ role: "assistant", content: pending });
          pending = "";
        }
      };

      await ipc.agentStream({ cli, messages, purpose, model }, (event) => {
        switch (event.type) {
          case "delta":
            pending += event.content;
            onDelta(event.content);
            break;
          case "tool_use":
            onMessage({
              role: "assistant",
              content: pending || null,
              tool_calls: [
                {
                  id: event.id,
                  type: "function",
                  function: {
                    name: event.name,
                    arguments: JSON.stringify(event.input ?? {}),
                  },
                },
              ],
            });
            pending = "";
            break;
          case "tool_result":
            onMessage({ role: "tool", content: event.content, tool_call_id: event.id });
            break;
          case "done":
            flushText();
            break;
          case "error":
            captured = { kind: event.kind, message: event.message };
            break;
        }
      }, signal);

      if (captured) {
        throw new AgentLoopError(captured);
      }
      // Stream ended without an explicit done (shouldn't happen) — don't drop text.
      flushText();
    },
  };
}
