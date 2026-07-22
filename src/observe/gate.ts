// S5.3 — Bubble gate: turns one observation into (maybe) a spoken remark.
// Time-driven — the runner calls forceAsk on a random cadence; the gate just
// keeps a short window-title history for context and, on each ask, runs one
// observe-model call that must answer with a short remark or the literal word
// SILENT. Interim state: title-only prompts — the semantic-snapshot content
// (Track F) replaces the removed screenshot path.
import i18n from "../i18n/index.ts";
import type { ChatMessage, SageIpc } from "../ipc/contract.ts";
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

export function createBubbleGate(options: GateOptions): BubbleGate {
  const historyLimit = options.historyLimit ?? 60;

  let samples: WindowSample[] = [];
  let asking = false;

  const debug = options.onDebug ?? (() => {});

  /** One model round-trip; returns the remark or null (silent/error). */
  async function ask(reason: string): Promise<string | null> {
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
          i18n.t("gate.noScreenshot", { ns: "prompt" }),
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
