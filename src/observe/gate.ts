// S5.3 — Bubble gate: turns one observation into (maybe) a companionable remark.
// Time-driven — the runner calls forceAsk on a random cadence. The gate is a
// two-stage "read the room, then speak" pipeline so proactive chatter feels
// like a companion instead of a blind single-shot:
//
//   [prefilter | no LLM]  same window as last ask AND we just spoke ⇒ skip
//                         (never keep nattering at an unchanged screen)
//   [stage 1  | cheap LLM, no snapshot]  assess: is now a good moment to chime
//                         in, and in what register? ⇒ SILENT or a focus hint
//   [stage 2  | LLM + snapshot]  compose: read the semantic snapshot (screen
//                         text — the screenshot's replacement) and say one line
//                         in character, or veto with SILENT.
//
// A short window-title history feeds the context; recently-said remarks feed
// both stages so the companion doesn't repeat itself or get monotonous. Idle
// mode (observation off) skips the prefilter/stage-1/snapshot entirely — it's a
// pure keep-them-company prompt with nothing to observe.
import i18n from "../i18n/index.ts";
import type {
  AgentActivity,
  ChatMessage,
  SageIpc,
  SemanticSnapshot,
} from "../ipc/contract.ts";
import { assessSystem, gateSystem } from "../store/persona.ts";
import type { RunObserve } from "./runObserve.ts";

/** One active-window observation, kept for the ask prompt's recent-activity list. */
export interface WindowSample {
  app_name: string;
  title: string;
  /** Sample time, epoch milliseconds. */
  at: number;
}

export interface GateOptions {
  ipc: Pick<SageIpc, "semanticSnapshot">;
  /** Run one observation turn against the active backend; null ⇒ nothing to say. */
  runObserve: RunObserve;
  /** A remark that passed the gate — show it as a bubble. */
  onBubble(text: string, reason: string): void;
  /** Samples kept for the recent-activity context. Default 60. */
  historyLimit?: number;
  /**
   * Idle-chatter mode (observation off): never reads window content, never
   * mentions window activity — the ask is a pure keep-them-company prompt.
   */
  idle?: boolean;
  /**
   * Read-only long-term memory injection: resolves the memory-index system
   * message (or null when memory is off / empty). Rides into both the assess
   * and compose prompts so a proactive remark can draw on what the companion
   * remembers — the same index chat.ts injects, but with no save/recall/forget
   * tools (proactive chatter is observe-only, i.e. read-only).
   */
  memoryPrefix?(): Promise<ChatMessage | null>;
  /**
   * Latest coding-agent activity (Claude Code / Codex), or null. Rides into
   * both stages so the companion can react to what the user is doing in the
   * terminal — what's running, what just finished, which tool ran. Resolved
   * once per ask (the runner's poller keeps it fresh); independent of screen
   * observation, so it works even in idle mode.
   */
  agentActivity?(): Promise<AgentActivity | null>;
  /** Diagnostic trace of each ask (assess/snapshot/stream error/reply). */
  onDebug?(message: string): void;
}

export interface BubbleGate {
  /** Feed one window sample into the recent-activity history (no ask). */
  record(sample: WindowSample): void;
  /**
   * Ask the model right now. Bubbles a genuine reply via onBubble;
   * resolves with it, or null when the model stayed silent or the call failed.
   */
  forceAsk(reason?: string): Promise<string | null>;
  /** Drop history + session memory (observation was turned off/on). */
  reset(): void;
}

/** How many recent remarks to feed back into the prompts (repetition guard). */
const RECENT_REMARKS_LIMIT = 5;

/**
 * Render a semantic snapshot as prompt lines, skipping empty fields — the
 * focused element (role — value), the selection, the visible text fragments
 * as bullets, and a truncation note. All labels resolve through the `prompt`
 * i18n namespace so the model reads them in the UI language.
 */
function renderSnapshot(snapshot: SemanticSnapshot): string {
  const lines: string[] = [];
  const detail = [snapshot.focused_role, snapshot.focused_value]
    .filter(Boolean)
    .join(" — ");
  if (detail) {
    lines.push(i18n.t("snapshot.focused", { ns: "prompt", detail }));
  }
  if (snapshot.selection) {
    lines.push(i18n.t("snapshot.selection", { ns: "prompt", text: snapshot.selection }));
  }
  for (const text of snapshot.texts) {
    if (text) lines.push(`- ${text}`);
  }
  if (snapshot.truncated) {
    lines.push(i18n.t("snapshot.truncated", { ns: "prompt" }));
  }
  return lines.join("\n");
}

/**
 * Render the coding-agent activity as prompt lines: a state line (with the
 * localized state word), the last tool, and the recent turn fragments. All
 * labels resolve through the `prompt` i18n namespace.
 */
function renderAgentActivity(agent: AgentActivity): string {
  const state = i18n.t(`agent.state_${agent.state}`, { ns: "prompt" });
  const lines: string[] = [
    i18n.t("agent.intro", { ns: "prompt", source: agent.source, state }),
  ];
  if (agent.tool) {
    lines.push(i18n.t("agent.tool", { ns: "prompt", tool: agent.tool }));
  }
  if (agent.texts.length > 0) {
    lines.push(i18n.t("agent.recent", { ns: "prompt" }));
    for (const text of agent.texts) lines.push(`- ${text}`);
  }
  return lines.join("\n");
}

export function createBubbleGate(options: GateOptions): BubbleGate {
  const historyLimit = options.historyLimit ?? 60;

  let samples: WindowSample[] = [];
  let asking = false;
  // Session-only memory (never persisted) so the companion knows what it just
  // said (avoid repeats / monotony) and which window it last spoke about.
  let recentRemarks: string[] = [];
  let lastAskWindow: WindowSample | null = null;
  // Signature of the coding-agent activity at the last ask — lets a fresh agent
  // action bypass the unchanged-screen prefilter.
  let lastAskAgentKey: string | null = null;

  const debug = options.onDebug ?? (() => {});

  const currentWindow = (): WindowSample | null =>
    samples.length > 0 ? samples[samples.length - 1] : null;

  const windowLabel = (w: WindowSample): string => `${w.app_name} — ${w.title}`;

  const recentActivityLines = (): string =>
    samples
      .slice(-8)
      .reverse()
      .map((s) => `- ${windowLabel(s)}`)
      .join("\n");

  /** The "you recently said…" repetition-guard block, or null when empty. */
  const recentlySaidBlock = (): string | null => {
    if (recentRemarks.length === 0) return null;
    const lines = recentRemarks.map((r) => `- ${r}`).join("\n");
    return i18n.t("gate.recentlySaid", { ns: "prompt", lines });
  };

  /** A one-line description of what changed since the last ask, or null. */
  const changeSince = (prev: WindowSample | null, now: WindowSample | null): string | null => {
    if (!prev || !now) return null;
    if (prev.app_name === now.app_name && prev.title === now.title) {
      return i18n.t("gate.noChange", { ns: "prompt" });
    }
    return i18n.t("gate.whatChanged", {
      ns: "prompt",
      from: windowLabel(prev),
      to: windowLabel(now),
    });
  };

  /**
   * Stage 1 — read the room. Cheap: recent titles + what changed + what we
   * recently said, no accessibility snapshot. Returns a focus hint (what to
   * notice + suggested register) or null (SILENT / not the moment / error).
   */
  async function assess(
    prev: WindowSample | null,
    memory: ChatMessage | null,
    agent: AgentActivity | null,
  ): Promise<string | null> {
    const change = changeSince(prev, currentWindow());
    const said = recentlySaidBlock();
    const text = [
      i18n.t("gate.assessInstruction", { ns: "prompt" }),
      i18n.t("gate.recentActivity", { ns: "prompt" }),
      recentActivityLines(),
      change,
      agent ? renderAgentActivity(agent) : null,
      said,
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n");

    const messages: ChatMessage[] = [
      { role: "system", content: await assessSystem() },
      ...(memory ? [memory] : []),
      { role: "user", content: text },
    ];

    const raw = await options.runObserve(messages, debug);
    if (raw === null) return null;
    const reply = raw.trim();
    if (!reply || reply.toUpperCase() === "SILENT") {
      debug(reply ? "Stage1 讀空氣：現在不適合插話（SILENT）" : "Stage1 回覆是空的");
      return null;
    }
    debug(`Stage1 讀空氣：${reply}`);
    return reply;
  }

  /**
   * Stage 2 — compose the actual remark, in character. Reads the best-effort
   * semantic snapshot (observe mode only), carries the stage-1 focus hint and
   * the repetition guard. Returns the remark or null (SILENT / error).
   */
  async function compose(
    reason: string,
    focus: string | null,
    memory: ChatMessage | null,
    agent: AgentActivity | null,
  ): Promise<string | null> {
    // The semantic snapshot is best-effort: a missing accessibility
    // permission, a sensitive window, or observation just turned off falls
    // back to the title-only prompt (PLAN privacy constraint). Idle mode
    // never even tries — there is nothing to observe.
    let snapshot: SemanticSnapshot | null = null;
    if (!options.idle) {
      try {
        snapshot = await options.ipc.semanticSnapshot();
        debug(`語意快照成功（${snapshot.texts.length} 段文字）`);
      } catch (err) {
        snapshot = null;
        debug(
          `語意快照失敗，退回純標題模式：${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const said = recentlySaidBlock();
    // Prompt strings resolve at ask time so a language switch takes effect
    // immediately (the reply language follows the UI language).
    const agentBlock = agent ? renderAgentActivity(agent) : null;
    const lines: (string | null)[] = options.idle
      ? [
          i18n.t("gate.trigger", { ns: "prompt", reason }),
          // No screen to read, but the coding-agent signal (if any) still gives
          // the companion something concrete to react to.
          agentBlock ?? i18n.t("gate.idleContext", { ns: "prompt" }),
          said,
        ]
      : [
          i18n.t("gate.trigger", { ns: "prompt", reason }),
          focus ? i18n.t("gate.focus", { ns: "prompt", focus }) : null,
          i18n.t("gate.recentActivity", { ns: "prompt" }),
          recentActivityLines(),
          snapshot
            ? i18n.t("gate.withSemantic", { ns: "prompt" })
            : i18n.t("gate.titleOnly", { ns: "prompt" }),
          snapshot ? renderSnapshot(snapshot) : null,
          agentBlock,
          said,
        ];
    const text = lines.filter((line): line is string => Boolean(line)).join("\n");

    const messages: ChatMessage[] = [
      { role: "system", content: await gateSystem() },
      ...(memory ? [memory] : []),
      { role: "user", content: text },
    ];

    // The backend (OpenRouter / agent CLI) handles its own errors and returns
    // null on failure — proactive chatter must never surface an error to the user.
    const raw = await options.runObserve(messages, debug);
    if (raw === null) return null;

    const reply = raw.trim();
    if (!reply || reply.toUpperCase() === "SILENT") {
      debug(reply ? "模型回 SILENT（判斷沒什麼值得說）" : "模型回覆是空的");
      return null;
    }
    debug(`模型回覆：${reply}`);
    return reply;
  }

  /** The full two-stage pipeline for one ask. */
  async function ask(reason: string): Promise<string | null> {
    const now = currentWindow();

    // Coding-agent activity: fetched once, shared by the prefilter and both
    // stages. Independent of screen observation, so idle mode still gets it.
    const agent = options.agentActivity ? await options.agentActivity() : null;
    const agentKey = agent
      ? `${agent.session}:${agent.state}:${agent.tool ?? ""}:${agent.texts.length}`
      : null;

    // Prefilter (observe mode only): don't keep nattering at a screen that
    // hasn't changed when we already spoke recently — but a fresh coding-agent
    // action (new state/tool/turn) is exactly the kind of thing worth reacting
    // to, so it bypasses the skip.
    if (
      !options.idle &&
      lastAskWindow &&
      now &&
      lastAskWindow.app_name === now.app_name &&
      lastAskWindow.title === now.title &&
      recentRemarks.length > 0 &&
      agentKey === lastAskAgentKey
    ) {
      debug("畫面未變且剛說過，跳過（不打任何 LLM）");
      return null;
    }

    const prev = lastAskWindow;
    lastAskWindow = now;
    lastAskAgentKey = agentKey;

    // Read-only memory index, fetched once and shared by both stages (a local
    // fs scan; one per ask, every few minutes — negligible). Null when memory
    // is off or empty.
    const memory = options.memoryPrefix ? await options.memoryPrefix() : null;

    // Stage 1 assess (observe mode only). Idle has nothing to read the room
    // with, so it goes straight to a companionship line.
    let focus: string | null = null;
    if (!options.idle) {
      focus = await assess(prev, memory, agent);
      if (focus === null) return null;
    }

    // Stage 2 compose.
    return compose(reason, focus, memory, agent);
  }

  return {
    record(sample) {
      samples = [...samples, sample].slice(-historyLimit);
    },

    async forceAsk(reason = i18n.t("gate.forceAskReason", { ns: "prompt" })) {
      if (asking) return null;
      asking = true;
      try {
        const reply = await ask(reason);
        if (reply) {
          options.onBubble(reply, reason);
          recentRemarks = [...recentRemarks, reply].slice(-RECENT_REMARKS_LIMIT);
        }
        return reply;
      } finally {
        asking = false;
      }
    },

    reset() {
      samples = [];
      asking = false;
      recentRemarks = [];
      lastAskWindow = null;
      lastAskAgentKey = null;
    },
  };
}
