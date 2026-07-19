import { test } from "node:test";
import assert from "node:assert/strict";
import i18n, { i18nReady } from "../src/i18n/index.ts";
import type { ContentPart, StreamEvent } from "../src/ipc/contract.ts";
import { createMockIpc } from "../src/ipc/mock.ts";
import { createBubbleGate, type GateOptions } from "../src/observe/gate.ts";
import type { WindowSample } from "../src/observe/notable.ts";

// Assertions below match the zh-TW wording — pin the locale regardless of the
// machine the tests run on.
await i18nReady;
await i18n.changeLanguage("zh-TW");

const MIN = 60_000;

/** One-completion script answering `text`. */
function reply(text: string): StreamEvent[] {
  return [
    { type: "delta", content: text },
    { type: "done", finish_reason: "stop" },
  ];
}

/** Feed a stuck run: same window sampled every minute from `fromMin` to `toMin`. */
async function feedDwell(
  gate: { offer(s: WindowSample): Promise<void> },
  setClock: (ms: number) => void,
  app: string,
  title: string,
  fromMin: number,
  toMin: number,
): Promise<void> {
  for (let m = fromMin; m <= toMin; m += 1) {
    setClock(m * MIN);
    await gate.offer({ app_name: app, title, at: m * MIN });
  }
}

interface Harness {
  bubbles: { text: string; reason: string }[];
  clock: { value: number };
}

function createHarness(
  ipc: GateOptions["ipc"],
  overrides: Partial<GateOptions> = {},
): { gate: ReturnType<typeof createBubbleGate> } & Harness {
  const bubbles: Harness["bubbles"] = [];
  const clock = { value: 0 };
  const gate = createBubbleGate({
    ipc,
    getModel: () => "test/vision-model",
    onBubble: (text, reason) => bubbles.push({ text, reason }),
    // Tight stuck threshold so tests stay short; other rules keep defaults.
    notableOptions: { stuckMs: 3 * MIN },
    now: () => clock.value,
    ...overrides,
  });
  return { gate, bubbles, clock };
}

test("not notable: never touches capture or the model", async () => {
  const ipc = createMockIpc({ settings: { observe_enabled: true } });
  const { gate, bubbles, clock } = createHarness(ipc);

  await feedDwell(gate, (ms) => (clock.value = ms), "Code", "a.ts", 0, 2);
  assert.equal(bubbles.length, 0);
  assert.equal(ipc.chatRequests.length, 0);
  assert.equal(ipc.calls.some((c) => c.command === "capture_screen"), false);
});

test("notable: captures, asks the observe model with the screenshot, bubbles the reply", async () => {
  const ipc = createMockIpc({
    settings: { observe_enabled: true },
    script: [reply("這個檔案卡了一陣子，要不要休息一下？")],
    screenshot: "data:image/jpeg;base64,SHOT",
  });
  const { gate, bubbles, clock } = createHarness(ipc);

  await feedDwell(gate, (ms) => (clock.value = ms), "Code", "main.rs", 0, 4);

  assert.equal(bubbles.length, 1);
  assert.equal(bubbles[0].text, "這個檔案卡了一陣子，要不要休息一下？");
  assert.match(bubbles[0].reason, /main\.rs/);

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
  assert.match(text.text, /Code/);
});

test("SILENT reply: spends the ask but shows nothing", async () => {
  const ipc = createMockIpc({
    settings: { observe_enabled: true },
    script: [reply("SILENT")],
  });
  const { gate, bubbles, clock } = createHarness(ipc);

  await feedDwell(gate, (ms) => (clock.value = ms), "Code", "a.ts", 0, 4);
  assert.equal(ipc.chatRequests.length, 1);
  assert.equal(bubbles.length, 0);
});

test("a persisting condition never re-asks; cooldown blocks new triggers", async () => {
  const ipc = createMockIpc({
    settings: { observe_enabled: true },
    script: [reply("嗨"), reply("回來啦")],
  });
  const { gate, bubbles, clock } = createHarness(ipc);
  const setClock = (ms: number) => (clock.value = ms);

  // Stuck fires once at minute 6 (3-min dwell); staying stuck must not ask
  // again even as the dwell keeps growing (its digits change every minute).
  await feedDwell(gate, setClock, "Code", "a.ts", 3, 8);
  assert.equal(ipc.chatRequests.length, 1);
  assert.equal(bubbles.length, 1);

  // Switching windows clears the condition; the idle-return trigger at
  // minute 13.5 is a *new* reason but lands 7.5 min after the minute-6 ask —
  // inside the 10-min cooldown, so no quota is spent.
  setClock(8.5 * MIN);
  await gate.offer({ app_name: "Slack", title: "#general", at: 8.5 * MIN });
  setClock(13.5 * MIN);
  await gate.offer({ app_name: "Chrome", title: "docs", at: 13.5 * MIN });
  assert.equal(ipc.chatRequests.length, 1); // cooldown held

  // Once the cooldown expires, a fresh trigger may ask again.
  setClock(19 * MIN);
  await gate.offer({ app_name: "Mail", title: "inbox", at: 19 * MIN });
  assert.equal(ipc.chatRequests.length, 2);
  assert.equal(bubbles[1].text, "回來啦");
});

test("hourly cap holds even with no cooldown", async () => {
  const ipc = createMockIpc({
    settings: { observe_enabled: true },
    script: [reply("一"), reply("二"), reply("三")],
  });
  const { gate, bubbles, clock } = createHarness(ipc, {
    cooldownMs: 0,
    maxPerHour: 2,
  });
  const setClock = (ms: number) => (clock.value = ms);

  // Three separate idle-return triggers (gap ≥ 5 min) in one hour, with a
  // normal-cadence sample after each so the condition clears in between.
  const apps = ["Slack", "Chrome", "Mail"];
  for (let i = 0; i < 3; i += 1) {
    const base = i * 14 * MIN;
    setClock(base);
    await gate.offer({ app_name: "Code", title: "a.ts", at: base });
    setClock(base + MIN);
    await gate.offer({ app_name: "Code", title: "a.ts", at: base + MIN });
    const returnAt = base + 7 * MIN;
    setClock(returnAt);
    await gate.offer({ app_name: apps[i], title: "inbox", at: returnAt });
  }

  assert.equal(ipc.chatRequests.length, 2);
  assert.deepEqual(
    bubbles.map((b) => b.text),
    ["一", "二"],
  );
});

test("screenshot failure falls back to a title-only ask", async () => {
  // observe_enabled:false makes the mock's captureScreen reject, mirroring
  // capture.rs (permission denied / observation just switched off).
  const ipc = createMockIpc({
    settings: { observe_enabled: false },
    script: [reply("看起來卡住了？")],
  });
  const { gate, bubbles, clock } = createHarness(ipc);

  await feedDwell(gate, (ms) => (clock.value = ms), "Code", "a.ts", 0, 4);

  assert.equal(bubbles.length, 1);
  assert.equal(ipc.chatRequests.length, 1);
  const content = ipc.chatRequests[0].messages[1].content;
  assert.equal(typeof content, "string"); // no image part at all
  assert.match(content as string, /視窗標題/);
});

test("forceAsk skips notable/cooldown/rate gates and bubbles the reply", async () => {
  const ipc = createMockIpc({
    settings: { observe_enabled: true },
    script: [reply("你正在看 gate 的測試。"), reply("SILENT")],
  });
  // maxPerHour 0 ⇒ the proactive path could never ask; forceAsk still must.
  const { gate, bubbles, clock } = createHarness(ipc, { maxPerHour: 0 });

  clock.value = MIN;
  await gate.offer({ app_name: "Code", title: "a.ts", at: MIN });
  const replyText = await gate.forceAsk();
  assert.equal(replyText, "你正在看 gate 的測試。");
  assert.equal(bubbles.length, 1);
  assert.equal(bubbles[0].text, "你正在看 gate 的測試。");
  assert.equal(ipc.chatRequests.length, 1);

  // SILENT still resolves null and shows nothing (caller decides what to do).
  const silent = await gate.forceAsk();
  assert.equal(silent, null);
  assert.equal(bubbles.length, 1);
});

test("stream errors and empty models stay silent", async () => {
  const errorIpc = createMockIpc({
    settings: { observe_enabled: true },
    script: [[{ type: "error", kind: "rate_limit", status: 429, message: "slow down" }]],
  });
  const errored = createHarness(errorIpc);
  await feedDwell(errored.gate, (ms) => (errored.clock.value = ms), "Code", "a.ts", 0, 4);
  assert.equal(errored.bubbles.length, 0);

  const idleIpc = createMockIpc({ settings: { observe_enabled: true } });
  const unconfigured = createHarness(idleIpc, { getModel: () => "" });
  await feedDwell(unconfigured.gate, (ms) => (unconfigured.clock.value = ms), "Code", "a.ts", 0, 4);
  assert.equal(idleIpc.chatRequests.length, 0);
  assert.equal(unconfigured.bubbles.length, 0);
});
