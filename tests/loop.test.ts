import { test } from "node:test";
import assert from "node:assert/strict";
import { AgentLoopError, runAgentLoop } from "../src/llm/loop.ts";
import { createToolRegistry } from "../src/tools/registry.ts";
import { createReadFileTool } from "../src/tools/readFile.ts";
import { createMockIpc } from "../src/ipc/mock.ts";
import type { ChatMessage, StreamEvent } from "../src/ipc/contract.ts";

const userMessage: ChatMessage = {
  role: "user",
  content: "Read /tmp/a.txt and summarize it.",
};

function makeRegistry(ipc: Parameters<typeof createReadFileTool>[0]) {
  return createToolRegistry([createReadFileTool(ipc)]);
}

test("runs a full read_file tool round trip on DEFAULT_SCRIPT", async () => {
  const ipc = createMockIpc({ files: { "/tmp/a.txt": "hello" } });
  const deltas: string[] = [];
  const messages = await runAgentLoop({
    ipc,
    model: "test/free-model",
    messages: [userMessage],
    tools: makeRegistry(ipc),
    onDelta: (text) => deltas.push(text),
  });

  assert.equal(messages.length, 4);
  assert.deepEqual(messages[0], userMessage);

  const assistant1 = messages[1];
  assert.equal(assistant1.role, "assistant");
  assert.equal(assistant1.content, "Let me look at that file.");
  assert.equal(assistant1.tool_calls?.[0].function.name, "read_file");

  const toolMsg = messages[2];
  assert.equal(toolMsg.role, "tool");
  assert.equal(toolMsg.tool_call_id, "call_1");
  assert.equal(toolMsg.content, "hello");

  const assistant2 = messages[3];
  assert.equal(assistant2.role, "assistant");
  assert.equal(assistant2.content, "The file says hello.");
  assert.equal(assistant2.tool_calls, undefined);

  assert.equal(deltas.join(""), "Let me look at that file.The file says hello.");

  // Two rounds; the second request carries the assistant + tool messages
  // and the registry's tool defs.
  assert.equal(ipc.chatRequests.length, 2);
  assert.equal(ipc.chatRequests[1].messages.length, 3);
  assert.equal(ipc.chatRequests[1].tools?.[0].function.name, "read_file");
});

test("missing file flows back to the model as an error string", async () => {
  const ipc = createMockIpc(); // no files
  const messages = await runAgentLoop({
    ipc,
    model: "test/free-model",
    messages: [userMessage],
    tools: makeRegistry(ipc),
  });
  const toolMsg = messages[2];
  assert.equal(toolMsg.role, "tool");
  assert.match(toolMsg.content as string, /^Error: file not found/);
});

test("unknown tools get an error result instead of crashing the loop", async () => {
  const ipc = createMockIpc(); // DEFAULT_SCRIPT asks for read_file
  const messages = await runAgentLoop({
    ipc,
    model: "test/free-model",
    messages: [userMessage],
    tools: createToolRegistry(), // empty registry
  });
  assert.equal(messages[2].content, "Error: unknown tool: read_file");
  assert.equal(messages[3].content, "The file says hello.");
});

test("abort mid-stream keeps the partial message and stops the loop", async () => {
  const ipc = createMockIpc({ files: { "/tmp/a.txt": "hello" } });
  const controller = new AbortController();
  const messages = await runAgentLoop({
    ipc,
    model: "test/free-model",
    messages: [userMessage],
    tools: makeRegistry(ipc),
    onDelta: () => controller.abort(), // abort on the first content delta
    signal: controller.signal,
  });
  // One partial assistant message, no tool execution, no second round.
  assert.equal(messages.length, 2);
  assert.equal(messages[1].role, "assistant");
  assert.equal(ipc.chatRequests.length, 1);
  assert.ok(!ipc.calls.some((c) => c.command === "tool_read_file"));
});

test("stream error events reject with an AgentLoopError carrying kind", async () => {
  const script: StreamEvent[][] = [
    [{ type: "error", kind: "auth", status: 401, message: "invalid key" }],
  ];
  const ipc = createMockIpc({ script });
  await assert.rejects(
    () =>
      runAgentLoop({
        ipc,
        model: "test/free-model",
        messages: [userMessage],
        tools: createToolRegistry(),
      }),
    (err: unknown) => {
      assert.ok(err instanceof AgentLoopError);
      assert.equal(err.kind, "auth");
      assert.equal(err.status, 401);
      assert.match(err.message, /invalid key/);
      return true;
    },
  );
});

test("maxRounds caps a model that keeps requesting tools", async () => {
  // Every round requests the same tool call, forever.
  const script: StreamEvent[][] = [
    [
      {
        type: "delta",
        tool_calls: [
          { index: 0, id: "call_x", function: { name: "read_file", arguments: '{"path":"/a"}' } },
        ],
      },
      { type: "done", finish_reason: "tool_calls" },
    ],
  ];
  const ipc = createMockIpc({ script, files: { "/a": "x" } });
  const messages = await runAgentLoop({
    ipc,
    model: "test/free-model",
    messages: [userMessage],
    tools: makeRegistry(ipc),
    maxRounds: 3,
  });
  assert.equal(ipc.chatRequests.length, 3);
  // user + 3 × (assistant + tool)
  assert.equal(messages.length, 7);
});

test("does not mutate the caller's messages array", async () => {
  const ipc = createMockIpc({ files: { "/tmp/a.txt": "hello" } });
  const initial = [userMessage];
  await runAgentLoop({
    ipc,
    model: "test/free-model",
    messages: initial,
    tools: makeRegistry(ipc),
  });
  assert.equal(initial.length, 1);
});
