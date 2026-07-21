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
import { proactiveTuning } from "../store/persona.ts";
import { createBubbleGate } from "./gate.ts";
import { pruneHourWindow, underHourlyQuota } from "./quota.ts";
import { createRunObserve } from "./runObserve.ts";
import { createSampler } from "./sampler.ts";

async function broadcast(event: string, payload: unknown): Promise<void> {
  if (!hasTauri()) return;
  const { emit } = await import("@tauri-apps/api/event");
  await emit(event, payload);
}

// Random spacing between observation asks. Dev builds use a short fixed
// interval so the whole capture → ask → bubble flow can be exercised in
// seconds; production derives it from the effective cooldownMinutes (pet's
// sage.proactive, else the settings default): random cooldown ~ 2.5×cooldown,
// so the default of 2 minutes keeps the original calm 2–5 min cadence.
const DEV_ASK_INTERVAL = { minMs: 15_000, maxMs: 30_000 };

async function nextAskDelay(): Promise<number> {
  if (import.meta.env.DEV) {
    const { minMs, maxMs } = DEV_ASK_INTERVAL;
    return minMs + Math.random() * (maxMs - minMs);
  }
  const { cooldownMinutes } = await proactiveTuning();
  const minMs = Math.max(0.1, cooldownMinutes) * 60_000;
  return minMs + Math.random() * minMs * 1.5;
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

    // When each bubble was shown — drives the maxPerHour quota.
    let bubbleTimes: number[] = [];

    // Shared by the gate and the dev test button: store + broadcast + show.
    const presentBubble = (text: string, reason: string) => {
      bubbleTimes = [...pruneHourWindow(bubbleTimes, Date.now()), Date.now()];
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
      runObserve: createRunObserve(ipc, () => useSettingsStore.getState().settings),
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

    // Time-driven observation: look immediately when observation turns on,
    // then on the cooldown-derived random cadence. The model's SILENT reply
    // filters content; the maxPerHour quota skips the ask (and its LLM call)
    // entirely once enough bubbles surfaced within the rolling hour.
    let askTimer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const runAsk = async () => {
      const { maxPerHour } = await proactiveTuning();
      if (underHourlyQuota(bubbleTimes, Date.now(), maxPerHour)) {
        void gate.forceAsk(i18n.t("gate.observeReason", { ns: "prompt" }));
      } else {
        devLog("ask skipped: hourly bubble quota reached (max", maxPerHour, "/h)");
      }
      const delay = await nextAskDelay();
      if (stopped) return;
      askTimer = setTimeout(() => void runAsk(), delay);
    };

    devLog("observation started, interval", Math.max(2, intervalSec), "s");
    sampler.start();
    askTimer = setTimeout(() => void runAsk(), 0);
    return () => {
      devLog("observation stopped");
      devRef.current = null;
      stopped = true;
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
