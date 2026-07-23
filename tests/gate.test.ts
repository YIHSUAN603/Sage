import { test } from "node:test";
import assert from "node:assert/strict";
import i18n, { i18nReady } from "../src/i18n/index.ts";
import type { ChatMessage, Settings, StreamEvent } from "../src/ipc/contract.ts";
import { DEFAULT_SETTINGS } from "../src/ipc/contract.ts";
import { createMockIpc, type MockIpc, type MockIpcOptions } from "../src/ipc/mock.ts";
import { buildMemoryIndexMessage } from "../src/memory/context.ts";
import { createRunObserve } from "../src/observe/runObserve.ts";
import {
  createBubbleGate,
  REMARK_TTL_MS,
  SAME_WINDOW_MUTE_MS,
  type WindowSample,
} from "../src/observe/gate.ts";

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

// The gate is two-stage in observe mode: stage 1 (assess / "read the room")
// then stage 2 (compose). Scripts feed the two calls in order — a non-SILENT
// stage-1 reply is the focus hint that unlocks stage 2.
const ASSESS_OK = reply("卡在同一個檔案一陣子了，用打氣的語氣");

interface Harness {
  bubbles: { text: string; reason: string }[];
}

function createHarness(
  ipc: MockIpc,
  settingsOverride: Partial<Settings> = {},
  idle = false,
  memoryPrefix?: () => Promise<ChatMessage | null>,
  now?: () => number,
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
    memoryPrefix,
    now,
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

test("semantic snapshot success: stage 2 prompt carries the screen text", async () => {
  const ipc = createMockIpc(
    observing({
      script: [ASSESS_OK, reply("這個檔案卡了一陣子，要不要休息一下？")],
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

  // Two calls: stage 1 (assess) then stage 2 (compose). The snapshot only
  // shows up in the stage-2 prompt.
  assert.equal(ipc.chatRequests.length, 2);
  const req = ipc.chatRequests[1];
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

  // Stage 1 never reads the snapshot — its prompt has no screen text.
  const assessText = ipc.chatRequests[0].messages[1].content as string;
  assert.doesNotMatch(assessText, /目前視窗的畫面文字/);
});

test("snapshot rendering skips empty fields", async () => {
  const ipc = createMockIpc(
    observing({
      script: [ASSESS_OK, reply("SILENT")],
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

  // stage 2 still reads + renders the snapshot before the SILENT reply.
  const text = ipc.chatRequests[1].messages[1].content as string;
  assert.match(text, /^- 只有一段文字$/m);
  assert.doesNotMatch(text, /焦點元件/);
  assert.doesNotMatch(text, /選取文字/);
  assert.doesNotMatch(text, /已截斷/);
});

test("semantic error (permission missing): falls back to title-only", async () => {
  const ipc = createMockIpc(
    observing({
      script: [ASSESS_OK, reply("看起來卡住了？")],
      semanticError: "macOS accessibility permission missing",
    }),
  );
  const { gate, bubbles } = createHarness(ipc);

  gate.record(sample("Code", "a.ts"));
  await gate.forceAsk();

  assert.equal(bubbles.length, 1); // the ask still went through
  assert.ok(commands(ipc).includes("semantic_snapshot")); // it did try
  const text = ipc.chatRequests[1].messages[1].content as string;
  assert.match(text, /無法取得畫面文字，只有視窗標題可參考/);
  assert.match(text, /Code — a\.ts/); // titles still present
  assert.doesNotMatch(text, /焦點元件/);
});

test("sensitive window: falls back to title-only", async () => {
  const ipc = createMockIpc(
    observing({
      script: [ASSESS_OK, reply("嗨")],
      sensitiveWindow: true,
    }),
  );
  const { gate } = createHarness(ipc);
  await gate.forceAsk();

  assert.ok(commands(ipc).includes("semantic_snapshot"));
  const text = ipc.chatRequests[1].messages[1].content as string;
  assert.match(text, /無法取得畫面文字，只有視窗標題可參考/);
  assert.doesNotMatch(text, /焦點元件/);
});

test("stage 1 SILENT: spends one cheap call, never reads a snapshot", async () => {
  const ipc = createMockIpc(observing({ script: [reply("SILENT")] }));
  const { gate, bubbles } = createHarness(ipc);

  gate.record(sample("Code", "main.rs"));
  const replyText = await gate.forceAsk();

  assert.equal(replyText, null);
  assert.equal(bubbles.length, 0);
  assert.equal(ipc.chatRequests.length, 1); // stage 1 only — no compose call
  assert.ok(!commands(ipc).includes("semantic_snapshot")); // and no AX read
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

test("agent-cli backend: codex takes both stages, snapshot in stage 2", async () => {
  const ipc = createMockIpc(
    observing({
      agentScript: [
        [{ type: "delta", content: "卡住了，用共鳴的語氣" }, { type: "done" }],
        [{ type: "delta", content: "需要幫忙嗎？" }, { type: "done" }],
      ],
    }),
  );
  const { gate, bubbles } = createHarness(ipc, {
    backend: "agent_cli",
    agent_cli: "codex",
  });

  gate.record(sample("Code", "main.rs"));
  const replyText = await gate.forceAsk();

  assert.equal(replyText, "需要幫忙嗎？");
  assert.equal(bubbles.length, 1);
  // Routed to the CLI, not OpenRouter; two turns (assess + compose).
  assert.equal(ipc.chatRequests.length, 0);
  assert.equal(ipc.agentRequests.length, 2);
  assert.equal(ipc.agentRequests[1].cli, "codex");
  assert.equal(ipc.agentRequests[1].purpose, "observe");
  const content = ipc.agentRequests[1].messages[1].content;
  assert.equal(typeof content, "string");
  assert.match(content as string, /目前視窗的畫面文字/); // snapshot included for codex too
});

test("idle mode: single stage, never reads a snapshot — pure companionship", async () => {
  const ipc = createMockIpc(observing({ script: [reply("嗨嗨，工作順利嗎？")] }));
  const { gate, bubbles } = createHarness(ipc, {}, true);

  gate.record(sample("Code", "secret-project.rs"));
  const replyText = await gate.forceAsk("定期跟使用者搭句話");

  assert.equal(replyText, "嗨嗨，工作順利嗎？");
  assert.equal(bubbles.length, 1);
  assert.ok(!commands(ipc).includes("semantic_snapshot")); // never even asked
  assert.equal(ipc.chatRequests.length, 1); // no assess stage in idle mode
  const content = ipc.chatRequests[0].messages[1].content;
  assert.equal(typeof content, "string");
  assert.match(content as string, /看不到使用者的畫面/); // the see-nothing framing
  assert.doesNotMatch(content as string, /secret-project/); // recorded titles never leak
  assert.doesNotMatch(content as string, /視窗標題/); // not the observation framing
});

test("prefilter: unchanged window skips within the mute window, no LLM call", async () => {
  const ipc = createMockIpc(
    observing({ script: [ASSESS_OK, reply("先講一句")] }),
  );
  const { gate, bubbles } = createHarness(ipc);

  gate.record(sample("Code", "a.ts"));
  const first = await gate.forceAsk();
  assert.equal(first, "先講一句");
  assert.equal(ipc.chatRequests.length, 2); // assess + compose

  // Same window, and we just spoke → prefiltered away, no new LLM call.
  gate.record(sample("Code", "a.ts", 1000));
  const second = await gate.forceAsk();
  assert.equal(second, null);
  assert.equal(ipc.chatRequests.length, 2); // unchanged
  assert.equal(bubbles.length, 1);
});

test("prefilter mute expires: unchanged window asks again, with the since-line", async () => {
  const ipc = createMockIpc(
    observing({
      script: [ASSESS_OK, reply("先講一句"), ASSESS_OK, reply("又來一句")],
    }),
  );
  let clock = 0;
  const { gate, bubbles } = createHarness(ipc, {}, false, undefined, () => clock);

  gate.record(sample("Code", "a.ts"));
  assert.equal(await gate.forceAsk(), "先講一句");
  // First ask: nothing was said before it, so no since-line anywhere.
  assert.doesNotMatch(ipc.chatRequests[0].messages[1].content as string, /你上次開口/);

  // Mute window elapsed on the very same window → the ask goes through again.
  clock = SAME_WINDOW_MUTE_MS;
  gate.record(sample("Code", "a.ts", clock));
  assert.equal(await gate.forceAsk(), "又來一句");
  assert.equal(ipc.chatRequests.length, 4); // assess#2 + compose#2 happened
  assert.equal(bubbles.length, 2);

  // Both second-ask prompts carry the "you last spoke ~N minutes ago" license.
  assert.match(ipc.chatRequests[2].messages[1].content as string, /你上次開口大約是 10 分鐘前/);
  assert.match(ipc.chatRequests[3].messages[1].content as string, /你上次開口大約是 10 分鐘前/);
});

test("repetition guard decays: remarks older than the TTL leave the prompts", async () => {
  const ipc = createMockIpc(
    observing({
      script: [ASSESS_OK, reply("第一句話"), ASSESS_OK, reply("第二句話")],
    }),
  );
  let clock = 0;
  const { gate } = createHarness(ipc, {}, false, undefined, () => clock);

  gate.record(sample("Code", "a.ts"));
  assert.equal(await gate.forceAsk(), "第一句話");

  // Past the TTL, in a different window: the old remark no longer suppresses.
  clock = REMARK_TTL_MS + 60_000;
  gate.record(sample("Slack", "#general", clock));
  assert.equal(await gate.forceAsk(), "第二句話");

  for (const req of [ipc.chatRequests[2], ipc.chatRequests[3]]) {
    const text = req.messages[1].content as string;
    assert.doesNotMatch(text, /第一句話/);
    assert.doesNotMatch(text, /你最近已經說過這些/);
    assert.match(text, /你上次開口大約是 31 分鐘前/); // elapsed silence still shown
  }
});

test("since-line minutes floor at 1 for a just-spoken remark", async () => {
  const ipc = createMockIpc(
    observing({
      script: [ASSESS_OK, reply("第一句話"), ASSESS_OK, reply("第二句話")],
    }),
  );
  let clock = 0;
  const { gate } = createHarness(ipc, {}, false, undefined, () => clock);

  gate.record(sample("Code", "a.ts"));
  await gate.forceAsk();

  // 10 s later in a new window (dodges the prefilter): still "1 分鐘前".
  clock = 10_000;
  gate.record(sample("Slack", "#general", clock));
  await gate.forceAsk();
  assert.match(ipc.chatRequests[2].messages[1].content as string, /你上次開口大約是 1 分鐘前/);
});

test("idle mode: the since-line reaches the single compose prompt too", async () => {
  const ipc = createMockIpc({
    script: [reply("嗨嗨"), reply("還在忙嗎？")],
  });
  let clock = 0;
  const { gate } = createHarness(ipc, {}, true, undefined, () => clock);

  assert.equal(await gate.forceAsk(), "嗨嗨");
  assert.doesNotMatch(ipc.chatRequests[0].messages[1].content as string, /你上次開口/);

  clock = 40 * 60_000;
  assert.equal(await gate.forceAsk(), "還在忙嗎？");
  assert.match(ipc.chatRequests[1].messages[1].content as string, /你上次開口大約是 40 分鐘前/);
});

test("repetition guard: the last remark is fed into the next ask's prompts", async () => {
  const ipc = createMockIpc(
    observing({
      script: [
        ASSESS_OK,
        reply("第一句話"),
        reply("換到別的地方了，用閒聊的語氣"),
        reply("第二句話"),
      ],
    }),
  );
  const { gate } = createHarness(ipc);

  gate.record(sample("Code", "a.ts"));
  assert.equal(await gate.forceAsk(), "第一句話");

  // Change window so the prefilter doesn't skip the second ask.
  gate.record(sample("Slack", "#general", 1000));
  assert.equal(await gate.forceAsk(), "第二句話");

  // chatRequests: [0]=assess#1 [1]=compose#1 [2]=assess#2 [3]=compose#2.
  const assess2 = ipc.chatRequests[2].messages[1].content as string;
  const compose2 = ipc.chatRequests[3].messages[1].content as string;
  assert.match(assess2, /你最近已經說過這些/);
  assert.match(assess2, /第一句話/);
  assert.match(compose2, /第一句話/);
});

test("reset clears the recent-activity history and session memory", async () => {
  const ipc = createMockIpc(observing({ script: [ASSESS_OK, reply("嗨")] }));
  const { gate } = createHarness(ipc);

  gate.record(sample("Slack", "#general"));
  gate.reset();
  await gate.forceAsk();

  // Neither stage should mention the dropped history.
  for (const req of ipc.chatRequests) {
    assert.doesNotMatch(req.messages[1].content as string, /Slack/);
  }
});

// The read-only memory index (index only — no bodies, no save/recall/forget
// tools) rides into proactive prompts so a companion that "remembers you"
// isn't memory-blind when it speaks first. Injected right after the persona
// system message, so with memory present messages = [persona, memory, user].
const memoryPrefixOf = (metas: { name: string; description: string }[]) => () =>
  Promise.resolve(buildMemoryIndexMessage(metas));

test("memory index rides into both the assess and compose prompts", async () => {
  const ipc = createMockIpc(
    observing({ script: [ASSESS_OK, reply("這個檔案卡了一陣子，要不要休息一下？")] }),
  );
  const { gate } = createHarness(
    ipc,
    {},
    false,
    memoryPrefixOf([{ name: "coffee-order", description: "喜歡燕麥拿鐵" }]),
  );

  gate.record(sample("Code", "main.rs"));
  await gate.forceAsk();

  assert.equal(ipc.chatRequests.length, 2); // assess + compose
  for (const req of ipc.chatRequests) {
    // [0]=persona system, [1]=memory system, [2]=user prompt.
    const memory = req.messages[1];
    assert.equal(memory.role, "system");
    const content = memory.content as string;
    assert.match(content, /coffee-order/); // the index name
    assert.match(content, /喜歡燕麥拿鐵/); // its one-line description
    assert.equal(req.messages[2].role, "user"); // user prompt shifted down
  }
});

test("no memoryPrefix (memory off): prompts carry no memory system message", async () => {
  const ipc = createMockIpc(
    observing({ script: [ASSESS_OK, reply("嗨")] }),
  );
  // memoryPrefix omitted — same as memory_enabled=false / empty memory.
  const { gate } = createHarness(ipc);

  gate.record(sample("Code", "main.rs"));
  await gate.forceAsk();

  for (const req of ipc.chatRequests) {
    assert.equal(req.messages.length, 2); // just persona system + user
    assert.equal(req.messages[1].role, "user");
  }
});

test("idle mode: memory index still reaches the single compose prompt", async () => {
  const ipc = createMockIpc({ script: [reply("嗨，喝杯燕麥拿鐵休息一下？")] });
  const { gate } = createHarness(
    ipc,
    {},
    true, // idle: observation off, no assess stage
    memoryPrefixOf([{ name: "coffee-order", description: "喜歡燕麥拿鐵" }]),
  );

  await gate.forceAsk();

  assert.equal(ipc.chatRequests.length, 1); // idle skips assess → compose only
  const memory = ipc.chatRequests[0].messages[1];
  assert.equal(memory.role, "system");
  assert.match(memory.content as string, /coffee-order/);
  assert.equal(ipc.chatRequests[0].messages[2].role, "user");
});
