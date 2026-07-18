// S2.3 — Function-calling agent loop. Each round streams one completion,
// executes any requested tools via the registry (data-driven — adding tools
// never changes this file), and feeds results back until the model converges.
import type { ChatMessage, SageIpc } from "../ipc/contract.ts";
import type { ToolRegistry } from "../tools/registry.ts";
import { createDeltaAccumulator } from "./openrouter.ts";
import type { StreamError } from "./openrouter.ts";

/** Thrown when the stream emits an "error" event. Carries the contract kind. */
export class AgentLoopError extends Error {
  kind: StreamError["kind"];
  status?: number;

  constructor(error: StreamError) {
    super(error.message);
    this.name = "AgentLoopError";
    this.kind = error.kind;
    this.status = error.status;
  }
}

export interface AgentLoopOptions {
  ipc: SageIpc;
  model: string;
  /** Initial conversation (not mutated; the returned array is a copy). */
  messages: ChatMessage[];
  tools: ToolRegistry;
  /** Called with each streamed content fragment, for live rendering. */
  onDelta?(text: string): void;
  /** Called as each assistant / tool message is appended to the history. */
  onMessage?(message: ChatMessage): void;
  /** Aborts streaming and stops the loop after the current round. */
  signal?: AbortSignal;
  /** Safety cap on completion rounds. Default 8. */
  maxRounds?: number;
}

/**
 * Run the loop to convergence and return the full message history, including
 * every assistant and role:"tool" message produced along the way.
 */
export async function runAgentLoop(opts: AgentLoopOptions): Promise<ChatMessage[]> {
  const { ipc, model, tools, onDelta, onMessage, signal } = opts;
  const maxRounds = opts.maxRounds ?? 8;
  const messages = [...opts.messages];
  const toolDefs = tools.toToolDefs();

  for (let round = 0; round < maxRounds; round += 1) {
    if (signal?.aborted) break;

    const acc = createDeltaAccumulator();
    await ipc.chatStream(
      {
        model,
        // Snapshot so later rounds never mutate an already-sent request.
        messages: [...messages],
        ...(toolDefs.length > 0 ? { tools: toolDefs } : {}),
      },
      (event) => {
        acc.push(event);
        if (event.type === "delta" && event.content) onDelta?.(event.content);
      },
      signal,
    );
    const { message, error } = acc.finish();
    if (error) throw new AgentLoopError(error);

    messages.push(message);
    onMessage?.(message);
    // Converged: nothing left to execute, or the user aborted mid-stream.
    if (!message.tool_calls || message.tool_calls.length === 0) break;
    if (signal?.aborted) break;

    for (const call of message.tool_calls) {
      const toolMessage: ChatMessage = {
        role: "tool",
        content: await executeToolCall(tools, call.function.name, call.function.arguments),
        tool_call_id: call.id,
      };
      messages.push(toolMessage);
      onMessage?.(toolMessage);
    }
  }

  return messages;
}

async function executeToolCall(
  tools: ToolRegistry,
  name: string,
  rawArguments: string,
): Promise<string> {
  const spec = tools.get(name);
  if (!spec) return `Error: unknown tool: ${name}`;

  let args: unknown;
  try {
    args = rawArguments.length > 0 ? JSON.parse(rawArguments) : {};
  } catch {
    return `Error: tool arguments are not valid JSON: ${rawArguments}`;
  }

  try {
    return await spec.execute(args);
  } catch (err) {
    // Specs should return error strings themselves, but guard anyway so one
    // misbehaving tool can never kill the whole loop.
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}
