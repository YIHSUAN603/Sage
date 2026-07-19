// S5.3 — Bubble gate: decides when the companion actually speaks up.
// Cheap first (assessNotable over window titles — zero API cost), and only
// when a trigger survives the cooldown / rate caps does it spend quota:
// screenshot (when available) + one observe-model call that must answer with
// a short remark or the literal word SILENT. Clock injectable for tests.
import i18n from "../i18n/index.ts";
import type { ChatMessage, ContentPart, SageIpc } from "../ipc/contract.ts";
import { createDeltaAccumulator } from "../llm/openrouter.ts";
import {
  assessNotable,
  type NotableOptions,
  type WindowSample,
} from "./notable.ts";

export interface GateOptions {
  ipc: Pick<SageIpc, "captureScreen" | "chatStream">;
  /** Observe model id (caller applies the chat-model fallback). Empty ⇒ stay silent. */
  getModel(): string;
  /** A remark that passed every gate — show it as a bubble. */
  onBubble(text: string, reason: string): void;
  /** Minimum time between model asks. Default 10 min. */
  cooldownMs?: number;
  /** Hard cap on model asks per rolling hour. Default 4. */
  maxPerHour?: number;
  notableOptions?: NotableOptions;
  now?(): number;
  /** Samples kept for the heuristics. Default 60. */
  historyLimit?: number;
  /** Diagnostic trace of each ask (capture ok/fail, stream error, reply). */
  onDebug?(message: string): void;
}

export interface BubbleGate {
  /** Feed one window sample; may (rarely) end in an onBubble call. */
  offer(sample: WindowSample): Promise<void>;
  /**
   * Skip every gate (notable/cooldown/rate) and ask the model right now —
   * the "user explicitly asked what Sage sees" path, also used by dev tests.
   * Bubbles a genuine reply via onBubble; resolves with it, or null when the
   * model stayed silent or the call failed.
   */
  forceAsk(reason?: string): Promise<string | null>;
  /** Drop history and cooldown state (observation was turned off/on). */
  reset(): void;
}

const HOUR_MS = 3_600_000;

/** Collapse digits so a persisting condition ("16 min stuck" → "17 min stuck")
 * counts as the same trigger and never re-asks until it clears. */
function reasonKey(reason: string): string {
  return reason.replace(/\d+/g, "#");
}

export function createBubbleGate(options: GateOptions): BubbleGate {
  const now = options.now ?? Date.now;
  const cooldownMs = options.cooldownMs ?? 10 * 60_000;
  const maxPerHour = options.maxPerHour ?? 4;
  const historyLimit = options.historyLimit ?? 60;

  let samples: WindowSample[] = [];
  let asking = false;
  let lastAskedAt = -Infinity;
  let askTimes: number[] = [];
  /** Key of the trigger we last spent an ask on; "" once it clears. */
  let lastKey = "";

  const debug = options.onDebug ?? (() => {});

  /** One model round-trip; returns the remark or null (silent/error). */
  async function ask(reason: string): Promise<string | null> {
    const model = options.getModel().trim();
    if (!model) {
      debug("沒有可用的模型（觀察/聊天模型都未設定）");
      return null; // nothing configured — never burn an error on the user
    }

    const at = now();
    lastAskedAt = at;
    askTimes = [...askTimes.filter((t) => at - t < HOUR_MS), at];

    // Screenshot is best-effort: permission denied / observation just turned
    // off falls back to the title-only prompt (PLAN privacy constraint).
    let screenshot: string | null = null;
    try {
      screenshot = await options.ipc.captureScreen();
      debug(`截圖成功（${Math.round(screenshot.length / 1024)}KB data URL）`);
    } catch (err) {
      screenshot = null;
      debug(`截圖失敗，退回純文字模式：${err instanceof Error ? err.message : String(err)}`);
    }

    const recentLines = samples
      .slice(-8)
      .reverse()
      .map((s) => `- ${s.app_name} — ${s.title}`)
      .join("\n");
    // Prompt strings resolve at ask time so a language switch takes effect
    // immediately (the reply language follows the UI language).
    const text = [
      i18n.t("gate.trigger", { ns: "prompt", reason }),
      i18n.t("gate.recentActivity", { ns: "prompt" }),
      recentLines,
      i18n.t(screenshot ? "gate.withScreenshot" : "gate.noScreenshot", {
        ns: "prompt",
      }),
    ].join("\n");

    const content: string | ContentPart[] = screenshot
      ? [
          { type: "text", text },
          { type: "image_url", image_url: { url: screenshot } },
        ]
      : text;
    const messages: ChatMessage[] = [
      { role: "system", content: i18n.t("gate.system", { ns: "prompt" }) },
      { role: "user", content },
    ];

    const acc = createDeltaAccumulator();
    try {
      await options.ipc.chatStream({ model, messages }, (event) => acc.push(event));
    } catch (err) {
      // network/invoke failure — proactive chatter must never error at the user
      debug(`chat_stream 呼叫失敗：${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
    const { message, error } = acc.finish();
    if (error) {
      debug(`串流回報錯誤：${error.kind}${error.status ? ` (${error.status})` : ""} — ${error.message}`);
      return null;
    }

    const reply = typeof message.content === "string" ? message.content.trim() : "";
    if (!reply || reply.toUpperCase() === "SILENT") {
      debug(reply ? "模型回 SILENT（判斷沒什麼值得說）" : "模型回覆是空的");
      return null;
    }
    debug(`模型回覆：${reply}`);
    return reply;
  }

  return {
    async offer(sample) {
      samples = [...samples, sample].slice(-historyLimit);
      if (asking) return;

      const result = assessNotable(samples, options.notableOptions);
      if (!result.notable) {
        lastKey = ""; // condition cleared — the next trigger may ask again
        return;
      }
      const key = reasonKey(result.reason);
      if (key === lastKey) return;

      const at = now();
      if (at - lastAskedAt < cooldownMs) return;
      if (askTimes.filter((t) => at - t < HOUR_MS).length >= maxPerHour) return;

      lastKey = key;
      asking = true;
      try {
        const reply = await ask(result.reason);
        if (reply) options.onBubble(reply, result.reason);
      } finally {
        asking = false;
      }
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
      lastAskedAt = -Infinity;
      askTimes = [];
      lastKey = "";
    },
  };
}
