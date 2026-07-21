import { test } from "node:test";
import assert from "node:assert/strict";
import i18n, { i18nReady } from "../src/i18n/index.ts";
import type { ContentPart, Settings, StreamEvent } from "../src/ipc/contract.ts";
import { DEFAULT_SETTINGS } from "../src/ipc/contract.ts";
import { createMockIpc, type MockIpc } from "../src/ipc/mock.ts";
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
): { gate: ReturnType<typeof createBubbleGate> } & Harness {
  const bubbles: Harness["bubbles"] = [];
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    observe_model: "test/vision-model",
    ...settingsOverride,
  };
  const gate = createBubbleGate({
    ipc,
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

test("forceAsk captures, asks the observe model with the screenshot, bubbles the reply", async () => {
  const ipc = createMockIpc({
    settings: { observe_enabled: true },
    script: [reply("這個檔案卡了一陣子，要不要休息一下？")],
    screenshot: "data:image/jpeg;base64,SHOT",
  });
  const { gate, bubbles } = createHarness(ipc);

  gate.record(sample("Code", "main.rs"));
  const replyText = await gate.forceAsk();

  assert.equal(replyText, "這個檔案卡了一陣子，要不要休息一下？");
  assert.equal(bubbles.length, 1);
  assert.equal(bubbles[0].text, "這個檔案卡了一陣子，要不要休息一下？");

  assert.equal(ipc.chatRequests.length, 1);
  const req = ipc.chatRequests[0];
  assert.equal(req.model, "test/vision-model");
  assert.equal(req.messages[0].role, "system");
  assert.equal(req.messages[1].role, "user");
  const parts = req.messages[1].content as ContentPart[];
  assert.ok(Array.isArray(parts));
  const image = parts.find((p) => p.type === "image_url");
  assert.ok(image && image.type === "image_url");
  assert.equal(image.image_url.url, "data:image/jpeg;base64,SHOT");
  const text = parts.find((p) => p.type === "text");
  assert.ok(text && text.type === "text");
  assert.match(text.text, /Code/); // recent-activity context carries the sample
});

test("SILENT reply: spends the ask but shows nothing", async () => {
  const ipc = createMockIpc({
    settings: { observe_enabled: true },
    script: [reply("SILENT")],
  });
  const { gate, bubbles } = createHarness(ipc);

  const replyText = await gate.forceAsk();
  assert.equal(replyText, null);
  assert.equal(ipc.chatRequests.length, 1);
  assert.equal(bubbles.length, 0);
});

test("screenshot failure falls back to a title-only ask", async () => {
  // observe_enabled:false makes the mock's captureScreen reject, mirroring
  // capture.rs (permission denied / observation just switched off).
  const ipc = createMockIpc({
    settings: { observe_enabled: false },
    script: [reply("看起來卡住了？")],
  });
  const { gate, bubbles } = createHarness(ipc);

  gate.record(sample("Code", "a.ts"));
  await gate.forceAsk();

  assert.equal(bubbles.length, 1);
  assert.equal(ipc.chatRequests.length, 1);
  const content = ipc.chatRequests[0].messages[1].content;
  assert.equal(typeof content, "string"); // no image part at all
  assert.match(content as string, /視窗標題/);
});

test("stream errors and empty models stay silent", async () => {
  const errorIpc = createMockIpc({
    settings: { observe_enabled: true },
    script: [[{ type: "error", kind: "rate_limit", status: 429, message: "slow down" }]],
  });
  const errored = createHarness(errorIpc);
  assert.equal(await errored.gate.forceAsk(), null);
  assert.equal(errored.bubbles.length, 0);

  const idleIpc = createMockIpc({ settings: { observe_enabled: true } });
  const unconfigured = createHarness(idleIpc, { observe_model: "", chat_model: "" });
  assert.equal(await unconfigured.gate.forceAsk(), null);
  assert.equal(idleIpc.chatRequests.length, 0); // never even reached the model
  assert.equal(unconfigured.bubbles.length, 0);
});

test("agent-cli backend: codex observes title-only (screenshot stripped)", async () => {
  const ipc = createMockIpc({
    settings: { observe_enabled: true },
    screenshot: "data:image/jpeg;base64,SHOT",
    agentScript: [[{ type: "delta", content: "需要幫忙嗎？" }, { type: "done" }]],
  });
  const { gate, bubbles } = createHarness(ipc, {
    backend: "agent_cli",
    agent_cli: "codex",
  });

  gate.record(sample("Code", "main.rs"));
  const reply = await gate.forceAsk();

  assert.equal(reply, "需要幫忙嗎？");
  assert.equal(bubbles.length, 1);
  // Routed to the CLI, not OpenRouter, and with no image part.
  assert.equal(ipc.chatRequests.length, 0);
  assert.equal(ipc.agentRequests.length, 1);
  assert.equal(ipc.agentRequests[0].cli, "codex");
  assert.equal(ipc.agentRequests[0].purpose, "observe");
  assert.equal(typeof ipc.agentRequests[0].messages[1].content, "string");
});

test("reset clears the recent-activity history", async () => {
  const ipc = createMockIpc({
    settings: { observe_enabled: true },
    script: [reply("嗨")],
  });
  const { gate } = createHarness(ipc);

  gate.record(sample("Slack", "#general"));
  gate.reset();
  await gate.forceAsk();

  const content = ipc.chatRequests[0].messages[1].content as ContentPart[];
  const text = content.find((p) => p.type === "text");
  assert.ok(text && text.type === "text");
  assert.doesNotMatch(text.text, /Slack/); // history was dropped
});
