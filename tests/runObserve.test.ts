// runObserve's OpenRouter path: the data_collection privacy policy and its
// no-eligible-provider fallback (strip the screenshot, retry title-only).
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

const withScreenshot: ChatMessage[] = [
  { role: "system", content: "gate system" },
  {
    role: "user",
    content: [
      { type: "text", text: "看看現在的畫面" },
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,SHOT" } },
    ],
  },
];

function makeRunObserve(
  script: StreamEvent[][],
  settingsOverride: Partial<Settings> = {},
) {
  const ipc = createMockIpc({ settings: { observe_enabled: true }, script });
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    observe_model: "test/vision-model",
    ...settingsOverride,
  };
  return { ipc, run: createRunObserve(ipc, () => settings) };
}

test("deny on (default): the request carries data_policy", async () => {
  const { ipc, run } = makeRunObserve([reply("嗨")]);
  assert.equal(await run(withScreenshot), "嗨");
  assert.equal(ipc.chatRequests.length, 1);
  assert.equal(ipc.chatRequests[0].data_policy, "deny");
});

test("deny off: no data_policy on the request", async () => {
  const { ipc, run } = makeRunObserve([reply("嗨")], {
    observe_deny_data_collection: false,
  });
  assert.equal(await run(withScreenshot), "嗨");
  assert.equal(ipc.chatRequests[0].data_policy, undefined);
});

test("no eligible provider: retries once title-only, deny kept", async () => {
  const { ipc, run } = makeRunObserve([NO_PROVIDER, reply("還在寫扣呀。")]);
  assert.equal(await run(withScreenshot), "還在寫扣呀。");

  assert.equal(ipc.chatRequests.length, 2);
  // First attempt: screenshot included.
  const first = ipc.chatRequests[0].messages[1].content;
  assert.ok(Array.isArray(first) && first.some((p) => p.type === "image_url"));
  // Retry: image stripped, text kept, privacy policy still on.
  const retry = ipc.chatRequests[1];
  assert.equal(retry.data_policy, "deny");
  assert.equal(typeof retry.messages[1].content, "string");
  assert.match(retry.messages[1].content as string, /看看現在的畫面/);
});

test("no retry when deny is off or no image was attached", async () => {
  const denyOff = makeRunObserve([NO_PROVIDER], {
    observe_deny_data_collection: false,
  });
  assert.equal(await denyOff.run(withScreenshot), null);
  assert.equal(denyOff.ipc.chatRequests.length, 1);

  const titleOnly = makeRunObserve([NO_PROVIDER]);
  const textMessages: ChatMessage[] = [
    { role: "system", content: "gate system" },
    { role: "user", content: "只有標題" },
  ];
  assert.equal(await titleOnly.run(textMessages), null);
  assert.equal(titleOnly.ipc.chatRequests.length, 1);
});

test("retry that errors again stays silent", async () => {
  const { ipc, run } = makeRunObserve([NO_PROVIDER, NO_PROVIDER]);
  assert.equal(await run(withScreenshot), null);
  assert.equal(ipc.chatRequests.length, 2);
});
