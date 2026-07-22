// runObserve's OpenRouter path: the data_collection privacy policy and error
// handling. Observation messages are always plain text (semantic snapshots,
// never images), so there is no strip-and-retry path anymore.
import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  ChatMessage,
  Settings,
  StreamEvent,
} from "../src/ipc/contract.ts";
import { DEFAULT_SETTINGS } from "../src/ipc/contract.ts";
import { createMockIpc } from "../src/ipc/mock.ts";
import { createRunObserve } from "../src/observe/runObserve.ts";

function reply(text: string): StreamEvent[] {
  return [
    { type: "delta", content: text },
    { type: "done", finish_reason: "stop" },
  ];
}

const NO_PROVIDER: StreamEvent[] = [
  {
    type: "error",
    kind: "api",
    status: 404,
    message: "No allowed providers are available for the selected model.",
  },
];

const textMessages: ChatMessage[] = [
  { role: "system", content: "gate system" },
  { role: "user", content: "看看現在的畫面文字" },
];

function makeRunObserve(
  script: StreamEvent[][],
  settingsOverride: Partial<Settings> = {},
) {
  const ipc = createMockIpc({ settings: { observe_enabled: true }, script });
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    observe_model: "test/observe-model",
    ...settingsOverride,
  };
  return { ipc, run: createRunObserve(ipc, () => settings) };
}

test("deny on (default): the request carries data_policy", async () => {
  const { ipc, run } = makeRunObserve([reply("嗨")]);
  assert.equal(await run(textMessages), "嗨");
  assert.equal(ipc.chatRequests.length, 1);
  assert.equal(ipc.chatRequests[0].data_policy, "deny");
});

test("deny off: no data_policy on the request", async () => {
  const { ipc, run } = makeRunObserve([reply("嗨")], {
    observe_deny_data_collection: false,
  });
  assert.equal(await run(textMessages), "嗨");
  assert.equal(ipc.chatRequests[0].data_policy, undefined);
});

test("a stream error stays silent — one attempt, no retry", async () => {
  const { ipc, run } = makeRunObserve([NO_PROVIDER, reply("不該被叫到")]);
  assert.equal(await run(textMessages), null);
  assert.equal(ipc.chatRequests.length, 1); // no strip-and-retry path anymore
});

test("observe_model falls back to chat_model when empty", async () => {
  const { ipc, run } = makeRunObserve([reply("嗨")], {
    observe_model: "",
    chat_model: "test/chat-model",
  });
  assert.equal(await run(textMessages), "嗨");
  assert.equal(ipc.chatRequests[0].model, "test/chat-model");
});

test("agent-cli backend: claude and codex take the same text-only path", async () => {
  for (const cli of ["claude", "codex"] as const) {
    const ipc = createMockIpc({
      settings: { observe_enabled: true },
      agentScript: [[{ type: "delta", content: "嗨" }, { type: "done" }]],
    });
    const settings: Settings = { ...DEFAULT_SETTINGS, backend: "agent_cli", agent_cli: cli };
    const run = createRunObserve(ipc, () => settings);

    assert.equal(await run(textMessages), "嗨");
    assert.equal(ipc.chatRequests.length, 0);
    assert.equal(ipc.agentRequests.length, 1);
    assert.equal(ipc.agentRequests[0].cli, cli);
    assert.equal(ipc.agentRequests[0].purpose, "observe");
    // Messages pass through untouched — no image stripping, nothing to strip.
    assert.deepEqual(ipc.agentRequests[0].messages, textMessages);
  }
});
