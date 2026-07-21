import { test } from "node:test";
import assert from "node:assert/strict";
import { AgentLoopError } from "../src/llm/loop.ts";
import { createAgentCliBackend } from "../src/llm/backend.ts";
import { createMockIpc } from "../src/ipc/mock.ts";
import type { AgentStreamEvent, ChatMessage } from "../src/ipc/contract.ts";

const userMessage: ChatMessage = { role: "user", content: "read /tmp/a.txt" };

test("agent-cli backend synthesizes assistant/tool/assistant messages from the stream", async () => {
  const ipc = createMockIpc(); // DEFAULT_AGENT_SCRIPT: text → tool_use → tool_result → text → done
  const deltas: string[] = [];
  const messages: ChatMessage[] = [];

  await createAgentCliBackend(ipc, "claude", "opus", "chat").runTurn({
    messages: [userMessage],
    onDelta: (t) => deltas.push(t),
    onMessage: (m) => messages.push(m),
  });

  // The turn: an assistant message carrying the pre-tool text + the tool_call,
  // then the tool result, then the final assistant answer.
  assert.equal(messages.length, 3);

  const [assistantWithTool, toolResult, finalAssistant] = messages;
  assert.equal(assistantWithTool.role, "assistant");
  assert.equal(assistantWithTool.content, "Let me look at that file.");
  assert.equal(assistantWithTool.tool_calls?.[0].id, "toolu_1");
  assert.equal(assistantWithTool.tool_calls?.[0].function.name, "Read");
  assert.equal(
    assistantWithTool.tool_calls?.[0].function.arguments,
    JSON.stringify({ file_path: "/tmp/a.txt" }),
  );

  assert.equal(toolResult.role, "tool");
  assert.equal(toolResult.tool_call_id, "toolu_1");
  assert.equal(toolResult.content, "hello.");

  assert.equal(finalAssistant.role, "assistant");
  assert.equal(finalAssistant.content, "The file says hello.");

  // The request carried the CLI + purpose + model through unchanged.
  assert.equal(ipc.agentRequests[0].cli, "claude");
  assert.equal(ipc.agentRequests[0].purpose, "chat");
  assert.equal(ipc.agentRequests[0].model, "opus");

  // Live text streamed for the cursor.
  assert.ok(deltas.join("").includes("Let me look at that file."));
});

test("a tool_use with no preceding text still emits an assistant message", async () => {
  const script: AgentStreamEvent[][] = [
    [
      { type: "tool_use", id: "t1", name: "Grep", input: { q: "x" } },
      { type: "tool_result", id: "t1", content: "match" },
      { type: "delta", content: "done" },
      { type: "done" },
    ],
  ];
  const ipc = createMockIpc({ agentScript: script });
  const messages: ChatMessage[] = [];

  await createAgentCliBackend(ipc, "codex", "", "chat").runTurn({
    messages: [userMessage],
    onDelta: () => {},
    onMessage: (m) => messages.push(m),
  });

  assert.equal(messages[0].role, "assistant");
  assert.equal(messages[0].content, null); // no text before the call
  assert.equal(messages[0].tool_calls?.[0].id, "t1");
  assert.equal(messages[1].role, "tool");
  assert.equal(messages[2].content, "done");
});

test("an error event surfaces as AgentLoopError after the stream settles", async () => {
  const script: AgentStreamEvent[][] = [
    [
      { type: "delta", content: "partial" },
      { type: "error", kind: "auth", message: "claude not found" },
    ],
  ];
  const ipc = createMockIpc({ agentScript: script });

  await assert.rejects(
    () =>
      createAgentCliBackend(ipc, "claude", "", "chat").runTurn({
        messages: [userMessage],
        onDelta: () => {},
        onMessage: () => {},
      }),
    (err: unknown) => {
      assert.ok(err instanceof AgentLoopError);
      assert.equal(err.kind, "auth");
      assert.equal(err.message, "claude not found");
      return true;
    },
  );
});
