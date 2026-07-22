import { test } from "node:test";
import assert from "node:assert/strict";
import { HISTORY_BUDGET_CHARS, truncateHistory } from "../src/llm/budget.ts";
import type { ChatMessage } from "../src/ipc/contract.ts";

test("HISTORY_BUDGET_CHARS is a sane positive budget", () => {
  assert.ok(HISTORY_BUDGET_CHARS > 0);
});

test("empty history stays empty", () => {
  assert.deepEqual(truncateHistory([]), []);
});

test("history within budget is returned unchanged", () => {
  const history: ChatMessage[] = [
    { role: "user", content: "hi" },
    { role: "assistant", content: "hello" },
    { role: "user", content: "how are you" },
  ];
  assert.deepEqual(truncateHistory(history), history);
});

test("drops the oldest messages when over budget, keeping the newest", () => {
  const history: ChatMessage[] = [
    { role: "user", content: "A".repeat(100) },
    { role: "assistant", content: "B".repeat(100) },
    { role: "user", content: "C".repeat(100) },
    { role: "assistant", content: "D".repeat(100) },
    { role: "user", content: "E".repeat(100) },
  ];
  // Budget fits ~3 messages of 100 chars.
  const kept = truncateHistory(history, 320);
  assert.deepEqual(
    kept.map((m) => (m.content as string)[0]),
    ["C", "D", "E"],
  );
});

test("keeps the last user turn even when it alone exceeds the budget", () => {
  const history: ChatMessage[] = [
    { role: "user", content: "old" },
    { role: "assistant", content: "reply" },
    { role: "user", content: "X".repeat(5000) },
  ];
  const kept = truncateHistory(history, 10);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].role, "user");
  assert.equal((kept[0].content as string).length, 5000);
});

test("never returns a tool message orphaned from its assistant owner", () => {
  const history: ChatMessage[] = [
    { role: "user", content: "U".repeat(200) },
    {
      role: "assistant",
      content: "L".repeat(100),
      tool_calls: [
        { id: "call_1", type: "function", function: { name: "read_file", arguments: "{}" } },
      ],
    },
    { role: "tool", content: "T".repeat(50), tool_call_id: "call_1" },
    { role: "assistant", content: "here is the answer" },
    { role: "user", content: "thanks" },
  ];
  // Budget lands the cut inside the tool group: the tool answer would fit, but
  // its owning assistant (100 chars) would be dropped — so the orphan must go too.
  const kept = truncateHistory(history, 70);
  // The orphaned tool message and its now-absent owner are both gone.
  assert.deepEqual(
    kept.map((m) => m.role),
    ["assistant", "user"],
  );
  // Every tool message kept (none here) would have its owning assistant present.
  for (let i = 0; i < kept.length; i++) {
    if (kept[i].role === "tool") {
      const owner = kept
        .slice(0, i)
        .some(
          (m) =>
            m.role === "assistant" &&
            m.tool_calls?.some((c) => c.id === kept[i].tool_call_id),
        );
      assert.ok(owner, "tool message must have its assistant owner in the slice");
    }
  }
});

test("keeps a tool group intact when the budget allows the whole group", () => {
  const history: ChatMessage[] = [
    { role: "user", content: "old and long ".repeat(50) },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        { id: "call_1", type: "function", function: { name: "read_file", arguments: "{}" } },
      ],
    },
    { role: "tool", content: "result", tool_call_id: "call_1" },
    { role: "assistant", content: "done" },
    { role: "user", content: "next question" },
  ];
  const kept = truncateHistory(history, 100);
  // The old user message is dropped; the intact tool group + trailing turns
  // remain, and the slice does not start with the orphaned tool message.
  assert.notEqual(kept[0].role, "tool");
  assert.deepEqual(
    kept.map((m) => m.role),
    ["assistant", "tool", "assistant", "user"],
  );
});
