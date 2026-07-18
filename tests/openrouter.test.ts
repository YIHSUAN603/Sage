import { test } from "node:test";
import assert from "node:assert/strict";
import {
  accumulateDeltas,
  createDeltaAccumulator,
} from "../src/llm/openrouter.ts";
import { DEFAULT_SCRIPT } from "../src/ipc/mock.ts";
import type { StreamEvent } from "../src/ipc/contract.ts";

test("accumulates DEFAULT_SCRIPT stream 1: content + sliced tool_call", () => {
  const { message, finishReason, error } = accumulateDeltas(DEFAULT_SCRIPT[0]);
  assert.equal(error, undefined);
  assert.equal(finishReason, "tool_calls");
  assert.equal(message.role, "assistant");
  assert.equal(message.content, "Let me look at that file.");
  assert.equal(message.tool_calls?.length, 1);
  const call = message.tool_calls![0];
  assert.equal(call.id, "call_1");
  assert.equal(call.type, "function");
  assert.equal(call.function.name, "read_file");
  assert.deepEqual(JSON.parse(call.function.arguments), { path: "/tmp/a.txt" });
});

test("accumulates DEFAULT_SCRIPT stream 2: plain text, no tool_calls", () => {
  const { message, finishReason, error } = accumulateDeltas(DEFAULT_SCRIPT[1]);
  assert.equal(error, undefined);
  assert.equal(finishReason, "stop");
  assert.equal(message.content, "The file says hello.");
  assert.equal(message.tool_calls, undefined);
});

test("captures error events and leaves finishReason null", () => {
  const events: StreamEvent[] = [
    { type: "delta", content: "partial" },
    { type: "error", kind: "auth", status: 401, message: "bad key" },
  ];
  const { message, finishReason, error } = accumulateDeltas(events);
  assert.deepEqual(error, { kind: "auth", status: 401, message: "bad key" });
  assert.equal(finishReason, null);
  assert.equal(message.content, "partial");
});

test("content is null when only tool_calls arrived", () => {
  const events: StreamEvent[] = [
    {
      type: "delta",
      tool_calls: [
        { index: 0, id: "call_9", function: { name: "t", arguments: "{}" } },
      ],
    },
    { type: "done", finish_reason: "tool_calls" },
  ];
  const { message } = accumulateDeltas(events);
  assert.equal(message.content, null);
  assert.equal(message.tool_calls?.length, 1);
});

test("multiple parallel tool_calls stay separated and ordered by index", () => {
  const events: StreamEvent[] = [
    {
      type: "delta",
      tool_calls: [
        { index: 1, id: "call_b", function: { name: "beta", arguments: "" } },
        { index: 0, id: "call_a", function: { name: "alpha", arguments: "" } },
      ],
    },
    { type: "delta", tool_calls: [{ index: 0, function: { arguments: '{"a"' } }] },
    { type: "delta", tool_calls: [{ index: 1, function: { arguments: '{"b"' } }] },
    { type: "delta", tool_calls: [{ index: 0, function: { arguments: ":1}" } }] },
    { type: "delta", tool_calls: [{ index: 1, function: { arguments: ":2}" } }] },
    { type: "done", finish_reason: "tool_calls" },
  ];
  const { message } = accumulateDeltas(events);
  assert.deepEqual(
    message.tool_calls?.map((c) => [c.id, c.function.name, c.function.arguments]),
    [
      ["call_a", "alpha", '{"a":1}'],
      ["call_b", "beta", '{"b":2}'],
    ],
  );
});

test("incremental accumulator matches the one-shot helper", () => {
  const acc = createDeltaAccumulator();
  for (const event of DEFAULT_SCRIPT[0]) acc.push(event);
  assert.deepEqual(acc.finish(), accumulateDeltas(DEFAULT_SCRIPT[0]));
});
