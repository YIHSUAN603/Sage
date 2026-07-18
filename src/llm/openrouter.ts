// S2.1 — Accumulate OpenRouter SSE stream events into a final assistant
// message. Pure functions only; runs under `node --experimental-strip-types`.
import type {
  ChatMessage,
  StreamErrorKind,
  StreamEvent,
  ToolCall,
} from "../ipc/contract.ts";

/** The error event payload, if the stream ended with `type:"error"`. */
export interface StreamError {
  kind: StreamErrorKind;
  status?: number;
  message: string;
}

export interface AccumulatedResult {
  /** The reconstructed assistant message (content + fully joined tool_calls). */
  message: ChatMessage;
  /** `finish_reason` from the "done" event, or null if none arrived. */
  finishReason: string | null;
  /** Present when the stream emitted an "error" event. */
  error?: StreamError;
}

/** Incrementally feedable accumulator: `push` each event, then `finish()`. */
export interface DeltaAccumulator {
  push(event: StreamEvent): void;
  finish(): AccumulatedResult;
}

interface PartialToolCall {
  id: string;
  name: string;
  arguments: string;
}

export function createDeltaAccumulator(): DeltaAccumulator {
  let content = "";
  let finishReason: string | null = null;
  let error: StreamError | undefined;
  // Sparse by index; OpenRouter sends id/name on the first fragment and
  // slices `function.arguments` across subsequent deltas of the same index.
  const toolCalls = new Map<number, PartialToolCall>();

  return {
    push(event) {
      if (event.type === "done") {
        finishReason = event.finish_reason;
        return;
      }
      if (event.type === "error") {
        error = { kind: event.kind, status: event.status, message: event.message };
        return;
      }
      if (event.content) content += event.content;
      for (const fragment of event.tool_calls ?? []) {
        let call = toolCalls.get(fragment.index);
        if (!call) {
          call = { id: "", name: "", arguments: "" };
          toolCalls.set(fragment.index, call);
        }
        if (fragment.id) call.id = fragment.id;
        if (fragment.function?.name) call.name = fragment.function.name;
        if (fragment.function?.arguments) {
          call.arguments += fragment.function.arguments;
        }
      }
    },

    finish() {
      const calls: ToolCall[] = [...toolCalls.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, call]) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: call.arguments },
        }));
      const message: ChatMessage = {
        role: "assistant",
        content: content.length > 0 ? content : null,
      };
      if (calls.length > 0) message.tool_calls = calls;
      return { message, finishReason, error };
    },
  };
}

/** One-shot convenience over `createDeltaAccumulator()`. */
export function accumulateDeltas(events: Iterable<StreamEvent>): AccumulatedResult {
  const acc = createDeltaAccumulator();
  for (const event of events) acc.push(event);
  return acc.finish();
}
