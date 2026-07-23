// Track D — chat store persistence + long-term memory integration.
// Drives the real zustand store with a MockIpc bound via store/ipc.ts, the
// same wiring main.tsx uses at bootstrap. i18n must be ready before send()
// builds the memory-index system message.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ChatMessage, Settings } from "../src/ipc/contract.ts";
import { DEFAULT_SETTINGS } from "../src/ipc/contract.ts";
import { createMockIpc, type MockIpc, type MockMemory } from "../src/ipc/mock.ts";
import i18n, { i18nReady } from "../src/i18n/index.ts";
import { bindIpc } from "../src/store/ipc.ts";
import { useChatStore } from "../src/store/chat.ts";
import { useSettingsStore } from "../src/store/settings.ts";

await i18nReady;
await i18n.changeLanguage("en");

const MEMORIES: MockMemory[] = [
  {
    name: "coffee-order",
    description: "Takes an oat-milk flat white",
    body: "The user always orders an oat-milk flat white.",
  },
];

/** Reset both stores and bind a fresh mock so each test starts clean. */
function setup(
  settings: Partial<Settings>,
  mockOpts: Parameters<typeof createMockIpc>[0] = {},
): MockIpc {
  const ipc = createMockIpc(mockOpts);
  bindIpc(ipc);
  useSettingsStore.setState({
    settings: { ...DEFAULT_SETTINGS, ...settings },
  });
  useChatStore.setState({
    messages: [],
    streaming: false,
    partial: "",
    error: null,
    abort: null,
  });
  return ipc;
}

const OPENROUTER: Partial<Settings> = {
  backend: "openrouter",
  chat_model: "test/free-model",
};

test("hydrate() loads the seeded persisted session", async () => {
  const seeded: ChatMessage[] = [
    { role: "user", content: "hi" },
    { role: "assistant", content: "hey there" },
  ];
  setup(OPENROUTER, { session: seeded });
  await useChatStore.getState().hydrate();
  assert.deepEqual(useChatStore.getState().messages, seeded);
});

test("hydrate() stays empty when there's no saved session", async () => {
  setup(OPENROUTER);
  await useChatStore.getState().hydrate();
  assert.deepEqual(useChatStore.getState().messages, []);
});

test("send() persists the visible history via save_session", async () => {
  const ipc = setup(OPENROUTER, { files: { "/tmp/a.txt": "hello" } });
  await useChatStore.getState().send("read the file");
  const saves = ipc.calls.filter((c) => c.command === "save_session");
  assert.ok(saves.length >= 1, "expected at least one save_session call");
  // The last save carries the finished turn, starting with the user's message.
  const lastSave = saves[saves.length - 1].args as ChatMessage[];
  assert.equal(lastSave[0].role, "user");
  assert.equal(lastSave[0].content, "read the file");
});

test("clear() archives the current conversation then empties it", async () => {
  const ipc = setup(OPENROUTER, { session: [{ role: "user", content: "old" }] });
  await useChatStore.getState().hydrate();
  await useChatStore.getState().clear();
  assert.ok(ipc.calls.some((c) => c.command === "archive_session"));
  assert.deepEqual(useChatStore.getState().messages, []);
  // Cleared history is persisted as an empty array.
  const saves = ipc.calls.filter((c) => c.command === "save_session");
  assert.deepEqual(saves[saves.length - 1].args, []);
});

test("memory_enabled: index is injected and memory tools are registered", async () => {
  const ipc = setup(
    { ...OPENROUTER, memory_enabled: true },
    { files: { "/tmp/a.txt": "hello" }, memories: MEMORIES },
  );
  await useChatStore.getState().send("hello");

  // Index injection: some system message names the remembered memory.
  const req = ipc.chatRequests[0];
  const systemText = req.messages
    .filter((m) => m.role === "system")
    .map((m) => (typeof m.content === "string" ? m.content : ""))
    .join("\n");
  assert.match(systemText, /coffee-order/);

  // The registry carries the three Sage memory tools alongside read_file.
  const toolNames = (req.tools ?? []).map((t) => t.function.name);
  assert.ok(toolNames.includes("recall_memory"));
  assert.ok(toolNames.includes("save_memory"));
  assert.ok(toolNames.includes("forget_memory"));
  // list_memories was consulted to build the index + tool catalogs.
  assert.ok(ipc.calls.some((c) => c.command === "list_memories"));
});

test("send() stamps ts on visible messages but strips it from requests", async () => {
  const ipc = setup(OPENROUTER, { files: { "/tmp/a.txt": "hello" } });
  await useChatStore.getState().send("read the file");

  for (const message of useChatStore.getState().messages) {
    assert.equal(typeof message.ts, "number", `expected ts on ${message.role}`);
  }
  // No request message may carry the UI-only ts field.
  for (const req of ipc.chatRequests) {
    for (const message of req.messages) {
      assert.ok(!("ts" in message), "ts leaked into a model request");
    }
  }
});

test("regenerate() drops the last answer and reruns the last user turn", async () => {
  const ipc = setup(OPENROUTER, { files: { "/tmp/a.txt": "hello" } });
  await useChatStore.getState().send("read the file");
  const afterSend = useChatStore.getState().messages;
  const requestsAfterSend = ipc.chatRequests.length;
  assert.ok(afterSend.length > 1, "expected a full turn after send");

  await useChatStore.getState().regenerate();
  const messages = useChatStore.getState().messages;
  // Exactly one user message survives — regenerate must not re-append it.
  assert.equal(messages.filter((m) => m.role === "user").length, 1);
  // The rerun produced a fresh full turn (mock script wraps around).
  assert.equal(messages.length, afterSend.length);
  // The rerun request ends with the original user text.
  const rerun = ipc.chatRequests[requestsAfterSend];
  const tail = rerun.messages[rerun.messages.length - 1];
  assert.equal(tail.role, "user");
  assert.equal(tail.content, "read the file");
  // Persistence matches the visible history after the rerun.
  const saves = ipc.calls.filter((c) => c.command === "save_session");
  assert.deepEqual(saves[saves.length - 1].args, messages);
});

test("regenerate() is a no-op mid-stream", async () => {
  const ipc = setup(OPENROUTER, { session: [{ role: "user", content: "hi" }] });
  await useChatStore.getState().hydrate();
  useChatStore.setState({ streaming: true });
  await useChatStore.getState().regenerate();
  assert.equal(ipc.chatRequests.length, 0);
});

test("regenerate() is a no-op without any user message", async () => {
  const ipc = setup(OPENROUTER);
  useChatStore.getState().openFromBubble("saw you're coding!");
  await useChatStore.getState().regenerate();
  assert.equal(ipc.chatRequests.length, 0);
  assert.equal(useChatStore.getState().messages.length, 1);
});

test("memory_enabled off: no index injection and no memory tools", async () => {
  const ipc = setup(
    { ...OPENROUTER, memory_enabled: false },
    { files: { "/tmp/a.txt": "hello" }, memories: MEMORIES },
  );
  await useChatStore.getState().send("hello");

  const req = ipc.chatRequests[0];
  const systemText = req.messages
    .filter((m) => m.role === "system")
    .map((m) => (typeof m.content === "string" ? m.content : ""))
    .join("\n");
  assert.doesNotMatch(systemText, /coffee-order/);

  const toolNames = (req.tools ?? []).map((t) => t.function.name);
  assert.ok(!toolNames.includes("recall_memory"));
  assert.ok(!toolNames.includes("save_memory"));
  assert.ok(!toolNames.includes("forget_memory"));
  // Memory is off, so the store never lists memories.
  assert.ok(!ipc.calls.some((c) => c.command === "list_memories"));
});
