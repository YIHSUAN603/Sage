// S5.3 — Bubble gate: turns one observation into (maybe) a spoken remark.
// Time-driven — the runner calls forceAsk on a random cadence; the gate keeps
// a short window-title history for context and, on each ask, reads a semantic
// snapshot of the focused window (accessibility text — the screenshot's
// replacement) + runs one observe-model call that must answer with a short
// remark or the literal word SILENT. Snapshot failures (permission missing,
// sensitive window, observation just off) fall back to title-only prompts.
import i18n from "../i18n/index.ts";
import type { ChatMessage, SageIpc, SemanticSnapshot } from "../ipc/contract.ts";
import { gateSystem } from "../store/persona.ts";
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
  /** Diagnostic trace of each ask (snapshot ok/fail, stream error, reply). */
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
  /** Drop history (observation was turned off/on). */
  reset(): void;
}

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

export function createBubbleGate(options: GateOptions): BubbleGate {
  const historyLimit = options.historyLimit ?? 60;

  let samples: WindowSample[] = [];
  let asking = false;

  const debug = options.onDebug ?? (() => {});

  /** One model round-trip; returns the remark or null (silent/error). */
  async function ask(reason: string): Promise<string | null> {
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

    const recentLines = samples
      .slice(-8)
      .reverse()
      .map((s) => `- ${s.app_name} — ${s.title}`)
      .join("\n");
    // Prompt strings resolve at ask time so a language switch takes effect
    // immediately (the reply language follows the UI language).
    const text = options.idle
      ? [
          i18n.t("gate.trigger", { ns: "prompt", reason }),
          i18n.t("gate.idleContext", { ns: "prompt" }),
        ].join("\n")
      : [
          i18n.t("gate.trigger", { ns: "prompt", reason }),
          i18n.t("gate.recentActivity", { ns: "prompt" }),
          recentLines,
          ...(snapshot
            ? [i18n.t("gate.withSemantic", { ns: "prompt" }), renderSnapshot(snapshot)]
            : [i18n.t("gate.titleOnly", { ns: "prompt" })]),
        ].join("\n");

    const messages: ChatMessage[] = [
      { role: "system", content: await gateSystem() },
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

  return {
    record(sample) {
      samples = [...samples, sample].slice(-historyLimit);
    },

    async forceAsk(reason = i18n.t("gate.forceAskReason", { ns: "prompt" })) {
      if (asking) return null;
      asking = true;
      try {
        const reply = await ask(reason);
        if (reply) options.onBubble(reply, reason);
        return reply;
      } finally {
        asking = false;
      }
    },

    reset() {
      samples = [];
      asking = false;
    },
  };
}
