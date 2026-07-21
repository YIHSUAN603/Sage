// S5.1/S5.3/S5.4 glue — runs in the avatar window (the only always-visible
// webview, so its timers are never throttled). Wires sampler → observation
// store + cross-window context broadcast + a time-driven bubble gate, honoring
// the settings switch: observe_enabled off ⇒ everything stops, nothing captured.
import { useEffect, useRef } from "react";
import {
  BUBBLE_EVENT,
  CONTEXT_EVENT,
  type BubbleEventPayload,
  type ContextEventPayload,
} from "../events.ts";
import i18n from "../i18n/index.ts";
import { hasTauri } from "../runtime.ts";
import { requireIpc } from "../store/ipc.ts";
import { useObservationStore } from "../store/observation.ts";
import { useSettingsStore } from "../store/settings.ts";
import { showBubbleWindow } from "../windows/chatToggle.ts";
import { createBubbleGate } from "./gate.ts";
import { createSampler } from "./sampler.ts";

async function broadcast(event: string, payload: unknown): Promise<void> {
  if (!hasTauri()) return;
  const { emit } = await import("@tauri-apps/api/event");
  await emit(event, payload);
}

// Random spacing between observation asks. Dev builds use a short interval so
// the whole capture → ask → bubble flow can be exercised in seconds; production
// keeps the calm 2–5 min cadence.
const ASK_INTERVAL = import.meta.env.DEV
  ? { minMs: 15_000, maxMs: 30_000 }
  : { minMs: 2 * 60_000, maxMs: 5 * 60_000 };

function nextAskDelay(): number {
  return ASK_INTERVAL.minMs + Math.random() * (ASK_INTERVAL.maxMs - ASK_INTERVAL.minMs);
}

function devLog(...args: unknown[]): void {
  if (import.meta.env.DEV) console.info("[sage:observe]", ...args);
}

export interface ObservationHandle {
  /** Whether observation is currently running (drives the pause badge). */
  observing: boolean;
  /** Dev builds only: force a real gate ask right now (null in production/off). */
  devForceAsk: (() => void) | null;
  /** Dev builds only: pop a fake bubble without touching the API. */
  devFakeBubble: (() => void) | null;
}

interface DevHelpers {
  forceAsk(): void;
  fakeBubble(): void;
}

/** Drive the observation subsystem while `observe_enabled` is on. */
export function useObservation(): ObservationHandle {
  const enabled = useSettingsStore((s) => s.settings.observe_enabled);
  const intervalSec = useSettingsStore((s) => s.settings.observe_interval);
  const devRef = useRef<DevHelpers | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const ipc = requireIpc();

    // Shared by the gate and the dev test button: store + broadcast + show.
    const presentBubble = (text: string, reason: string) => {
      devLog("bubble:", text, "| reason:", reason);
      useObservationStore.getState().pushBubble(text, reason);
      const bubbles = useObservationStore.getState().bubbles;
      const bubble = bubbles[bubbles.length - 1];
      const payload: BubbleEventPayload = {
        id: bubble?.id ?? crypto.randomUUID(),
        text,
        reason,
      };
      void broadcast(BUBBLE_EVENT, payload).then(showBubbleWindow);
    };

    // Trail of the most recent ask's diagnostics (capture/stream/reply) — the
    // dev test bubble surfaces it so failures explain themselves.
    let askTrail: string[] = [];
    const gate = createBubbleGate({
      ipc,
      getModel() {
        const s = useSettingsStore.getState().settings;
        return (s.observe_model.trim() || s.chat_model).trim();
      },
      onBubble: presentBubble,
      onDebug(message) {
        devLog("ask:", message);
        askTrail.push(message);
      },
    });

    if (import.meta.env.DEV) {
      devRef.current = {
        forceAsk() {
          devLog("forceAsk: asking the model now…");
          askTrail = [];
          void gate.forceAsk("開發測試：立即觀察一次").then((reply) => {
            // A genuine reply already bubbled via onBubble — surface the
            // silent/error case too, with the diagnostic trail, so the
            // tester sees exactly which step went sideways.
            if (!reply) {
              presentBubble(`（測試）${askTrail.join("；") || "沒有任何診斷訊息"}`, "dev forceAsk");
            }
          });
        },
        fakeBubble() {
          presentBubble(
            "嗨，我是測試氣泡！點我會展開聊天，12 秒後自動消失。",
            "dev fakeBubble",
          );
        },
      };
    }

    const sampler = createSampler({
      ipc,
      intervalMs: Math.max(2, intervalSec) * 1000,
      onSample(window, at) {
        devLog("sample:", window ? `${window.app_name} — ${window.title}` : "(none)");
        useObservationStore.getState().pushContext(window, at);
        const payload: ContextEventPayload = { window, at };
        void broadcast(CONTEXT_EVENT, payload);
        if (window) {
          gate.record({ app_name: window.app_name, title: window.title, at });
        }
      },
    });

    // Time-driven observation: look immediately when observation turns on, then
    // once every random 2–5 min. The model's SILENT reply is the only filter.
    let askTimer: ReturnType<typeof setTimeout> | null = null;
    const runAsk = () => {
      void gate.forceAsk(i18n.t("gate.observeReason", { ns: "prompt" }));
      askTimer = setTimeout(runAsk, nextAskDelay());
    };

    devLog("observation started, interval", Math.max(2, intervalSec), "s");
    sampler.start();
    askTimer = setTimeout(runAsk, 0);
    return () => {
      devLog("observation stopped");
      devRef.current = null;
      if (askTimer) clearTimeout(askTimer);
      sampler.stop();
      gate.reset();
    };
  }, [enabled, intervalSec]);

  const devAvailable = import.meta.env.DEV && enabled;
  return {
    observing: enabled,
    devForceAsk: devAvailable ? () => devRef.current?.forceAsk() : null,
    devFakeBubble: devAvailable ? () => devRef.current?.fakeBubble() : null,
  };
}
