import { test } from "node:test";
import assert from "node:assert/strict";
import i18n, { i18nReady } from "../src/i18n/index.ts";
import type { Settings, StreamEvent } from "../src/ipc/contract.ts";
import { DEFAULT_SETTINGS } from "../src/ipc/contract.ts";
import { createMockIpc, type MockIpc, type MockIpcOptions } from "../src/ipc/mock.ts";
import { createRunObserve } from "../src/observe/runObserve.ts";
import { createBubbleGate, type WindowSample } from "../src/observe/gate.ts";

// Assertions below match the zh-TW wording — pin the locale regardless of the
// machine the tests run on.
await i18nReady;
await i18n.changeLanguage("zh-TW");

/** One-completion script answering `text`. */
function reply(text: string): StreamEvent[] {
  return [
    { type: "delta", content: text },
    { type: "done", finish_reason: "stop" },
  ];
}

interface Harness {
  bubbles: { text: string; reason: string }[];
}

function createHarness(
  ipc: MockIpc,
  settingsOverride: Partial<Settings> = {},
  idle = false,
): { gate: ReturnType<typeof createBubbleGate> } & Harness {
  const bubbles: Harness["bubbles"] = [];
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    observe_model: "test/observe-model",
    ...settingsOverride,
  };
  const gate = createBubbleGate({
    ipc,
    idle,
    runObserve: createRunObserve(ipc, () => settings),
    onBubble: (text, reason) => bubbles.push({ text, reason }),
  });
  return { gate, bubbles };
}

const sample = (app: string, title: string, at = 0): WindowSample => ({
  app_name: app,
  title,
  at,
});

/** Commands the mock recorded, for call-order/presence assertions. */
const commands = (ipc: MockIpc) => ipc.calls.map((c) => c.command);

const observing = (extra: MockIpcOptions = {}): MockIpcOptions => ({
  settings: { observe_enabled: true },
  ...extra,
});

test("semantic snapshot success: the prompt carries the screen text", async () => {
  const ipc = createMockIpc(
    observing({
      script: [reply("這個檔案卡了一陣子，要不要休息一下？")],
      snapshot: {
        focused_role: "AXTextArea",
        focused_value: "export function createBubbleGate(",
        selection: "createBubbleGate",
        texts: ["gate.ts — Sage", "export function createBubbleGate("],
        truncated: true,
      },
    }),
  );
  const { gate, bubbles } = createHarness(ipc);

  gate.record(sample("Code", "main.rs"));
  const replyText = await gate.forceAsk();

  assert.equal(replyText, "這個檔案卡了一陣子，要不要休息一下？");
  assert.equal(bubbles.length, 1);
  assert.ok(commands(ipc).includes("semantic_snapshot"));

  assert.equal(ipc.chatRequests.length, 1);
  const req = ipc.chatRequests[0];
  assert.equal(req.model, "test/observe-model");
  assert.equal(req.messages[0].role, "system");
  const content = req.messages[1].content;
  assert.equal(typeof content, "string"); // prompts are text-only, always
  const text = content as string;
  assert.match(text, /Code — main\.rs/); // recent-activity context
  assert.match(text, /目前視窗的畫面文字（經系統輔助功能介面讀取）：/);
  assert.match(text, /焦點元件：AXTextArea — export function createBubbleGate\(/);
  assert.match(text, /選取文字：createBubbleGate/);
  assert.match(text, /^- gate\.ts — Sage$/m); // texts as bullets
  assert.match(text, /畫面文字過長，已截斷/);
  assert.doesNotMatch(text, /無法取得畫面文字/); // not the fallback framing
});

test("snapshot rendering skips empty fields", async () => {
  const ipc = createMockIpc(
    observing({
      script: [reply("SILENT")],
      snapshot: {
        focused_role: "",
        focused_value: "",
        selection: "",
        texts: ["只有一段文字"],
        truncated: false,
      },
    }),
  );
  const { gate } = createHarness(ipc);
  await gate.forceAsk();

  const text = ipc.chatRequests[0].messages[1].content as string;
  assert.match(text, /^- 只有一段文字$/m);
  assert.doesNotMatch(text, /焦點元件/);
  assert.doesNotMatch(text, /選取文字/);
  assert.doesNotMatch(text, /已截斷/);
});

test("semantic error (permission missing): falls back to title-only", async () => {
  const ipc = createMockIpc(
    observing({
      script: [reply("看起來卡住了？")],
      semanticError: "macOS accessibility permission missing",
    }),
  );
  const { gate, bubbles } = createHarness(ipc);

  gate.record(sample("Code", "a.ts"));
  await gate.forceAsk();

  assert.equal(bubbles.length, 1); // the ask still went through
  assert.ok(commands(ipc).includes("semantic_snapshot")); // it did try
  const text = ipc.chatRequests[0].messages[1].content as string;
  assert.match(text, /無法取得畫面文字，只有視窗標題可參考/);
  assert.match(text, /Code — a\.ts/); // titles still present
  assert.doesNotMatch(text, /焦點元件/);
});

test("sensitive window: falls back to title-only", async () => {
  const ipc = createMockIpc(
    observing({
      script: [reply("嗨")],
      sensitiveWindow: true,
    }),
  );
  const { gate } = createHarness(ipc);
  await gate.forceAsk();

  assert.ok(commands(ipc).includes("semantic_snapshot"));
  const text = ipc.chatRequests[0].messages[1].content as string;
  assert.match(text, /無法取得畫面文字，只有視窗標題可參考/);
  assert.doesNotMatch(text, /焦點元件/);
});

test("SILENT reply: spends the ask but shows nothing", async () => {
  const ipc = createMockIpc(observing({ script: [reply("SILENT")] }));
  const { gate, bubbles } = createHarness(ipc);

  const replyText = await gate.forceAsk();
  assert.equal(replyText, null);
  assert.equal(ipc.chatRequests.length, 1);
  assert.equal(bubbles.length, 0);
});

test("stream errors and empty models stay silent", async () => {
  const errorIpc = createMockIpc(
    observing({
      script: [[{ type: "error", kind: "rate_limit", status: 429, message: "slow down" }]],
    }),
  );
  const errored = createHarness(errorIpc);
  assert.equal(await errored.gate.forceAsk(), null);
  assert.equal(errored.bubbles.length, 0);

  const unconfiguredIpc = createMockIpc(observing());
  const unconfigured = createHarness(unconfiguredIpc, { observe_model: "", chat_model: "" });
  assert.equal(await unconfigured.gate.forceAsk(), null);
  assert.equal(unconfiguredIpc.chatRequests.length, 0); // never even reached the model
  assert.equal(unconfigured.bubbles.length, 0);
});

test("agent-cli backend: codex takes the same semantic prompt", async () => {
  const ipc = createMockIpc(
    observing({
      agentScript: [[{ type: "delta", content: "需要幫忙嗎？" }, { type: "done" }]],
    }),
  );
  const { gate, bubbles } = createHarness(ipc, {
    backend: "agent_cli",
    agent_cli: "codex",
  });

  gate.record(sample("Code", "main.rs"));
  const reply = await gate.forceAsk();

  assert.equal(reply, "需要幫忙嗎？");
  assert.equal(bubbles.length, 1);
  // Routed to the CLI, not OpenRouter, with the same text-only semantic prompt.
  assert.equal(ipc.chatRequests.length, 0);
  assert.equal(ipc.agentRequests.length, 1);
  assert.equal(ipc.agentRequests[0].cli, "codex");
  assert.equal(ipc.agentRequests[0].purpose, "observe");
  const content = ipc.agentRequests[0].messages[1].content;
  assert.equal(typeof content, "string");
  assert.match(content as string, /目前視窗的畫面文字/); // snapshot included for codex too
});

test("idle mode: never reads a snapshot — a pure companionship prompt", async () => {
  const ipc = createMockIpc(observing({ script: [reply("嗨嗨，工作順利嗎？")] }));
  const { gate, bubbles } = createHarness(ipc, {}, true);

  gate.record(sample("Code", "secret-project.rs"));
  const replyText = await gate.forceAsk("定期跟使用者搭句話");

  assert.equal(replyText, "嗨嗨，工作順利嗎？");
  assert.equal(bubbles.length, 1);
  assert.ok(!commands(ipc).includes("semantic_snapshot")); // never even asked
  assert.equal(ipc.chatRequests.length, 1);
  const content = ipc.chatRequests[0].messages[1].content;
  assert.equal(typeof content, "string");
  assert.match(content as string, /看不到使用者的畫面/); // the see-nothing framing
  assert.doesNotMatch(content as string, /secret-project/); // recorded titles never leak
  assert.doesNotMatch(content as string, /視窗標題/); // not the observation framing
});

test("reset clears the recent-activity history", async () => {
  const ipc = createMockIpc(observing({ script: [reply("嗨")] }));
  const { gate } = createHarness(ipc);

  gate.record(sample("Slack", "#general"));
  gate.reset();
  await gate.forceAsk();

  const content = ipc.chatRequests[0].messages[1].content;
  assert.equal(typeof content, "string");
  assert.doesNotMatch(content as string, /Slack/); // history was dropped
});
