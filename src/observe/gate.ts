// S5.3 — Bubble gate: turns one observation into (maybe) a spoken remark.
// Time-driven — the runner calls forceAsk on a random cadence; the gate just
// keeps a short window-title history for context and, on each ask, captures a
// screenshot (when available) + runs one observe-model call that must answer
// with a short remark or the literal word SILENT.
import i18n from "../i18n/index.ts";
import type { ChatMessage, ContentPart, SageIpc } from "../ipc/contract.ts";
import { gateSystem } from "../store/persona.ts";
import { createDeltaAccumulator } from "../llm/openrouter.ts";

/** One active-window observation, kept for the ask prompt's recent-activity list. */
export interface WindowSample {
  app_name: string;
  title: string;
  /** Sample time, epoch milliseconds. */
  at: number;
}

export interface GateOptions {
  ipc: Pick<SageIpc, "captureScreen" | "chatStream">;
  /** Observe model id (caller applies the chat-model fallback). Empty ⇒ stay silent. */
  getModel(): string;
  /** A remark that passed the gate — show it as a bubble. */
  onBubble(text: string, reason: string): void;
  /** Samples kept for the recent-activity context. Default 60. */
  historyLimit?: number;
  /** Diagnostic trace of each ask (capture ok/fail, stream error, reply). */
  onDebug?(message: string): void;
}

export interface BubbleGate {
  /** Feed one window sample into the recent-activity history (no ask). */
  record(sample: WindowSample): void;
  /**
   * Capture + ask the model right now. Bubbles a genuine reply via onBubble;
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
    const model = options.getModel().trim();
    if (!model) {
      debug("沒有可用的模型（觀察/聊天模型都未設定）");
      return null; // nothing configured — never burn an error on the user
    }

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
      { role: "system", content: await gateSystem() },
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
