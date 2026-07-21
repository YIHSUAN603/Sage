// S5.1/S5.3/S5.4 glue — runs in the avatar window (the only always-visible
// webview, so its timers are never throttled). Wires sampler → observation
// store + cross-window context broadcast + bubble gate, honoring the settings
// switch: observe_enabled off ⇒ everything stops, nothing is captured.
import { useEffect, useRef, useState } from "react";
import {
  BUBBLE_EVENT,
  CONTEXT_EVENT,
  type BubbleEventPayload,
  type ContextEventPayload,
} from "../events.ts";
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

// Dev builds shrink the trigger thresholds and cooldown so the whole bubble
// flow can be exercised in a few minutes (PLAN S6.3 manual E2E). Production
// keeps the calm defaults from notable.ts / gate.ts.
const DEV_TUNING = import.meta.env.DEV
  ? {
      notableOptions: {
        stuckMs: 2 * 60_000,
        rapidSwitchWindowMs: 60_000,
        rapidSwitchCount: 4,
        idleGapMs: 2 * 60_000,
      },
      cooldownMs: 60_000,
    }
  : {};

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
  const activePet = useSettingsStore((s) => s.settings.active_pet);
  const devRef = useRef<DevHelpers | null>(null);

  // The active companion may override the gate's cadence via pet.json's
  // `sage.proactive`. Loaded here (async) so the main effect can re-create the
  // gate with the new numbers when the pet changes. DEV_TUNING still wins.
  const [petGate, setPetGate] = useState<{ cooldownMs?: number; maxPerHour?: number }>({});
  useEffect(() => {
    let cancelled = false;
    const id = activePet.trim();
    if (!id) {
      setPetGate({});
      return;
    }
    void (async () => {
      try {
        const pet = await requireIpc().readPet(id);
        if (cancelled) return;
        const p = pet.proactive ?? {};
        const next: { cooldownMs?: number; maxPerHour?: number } = {};
        if (typeof p.cooldownMinutes === "number") next.cooldownMs = p.cooldownMinutes * 60_000;
        if (typeof p.maxPerHour === "number") next.maxPerHour = p.maxPerHour;
        setPetGate(next);
      } catch {
        if (!cancelled) setPetGate({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activePet]);

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
      ...petGate,
      ...DEV_TUNING,
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
          devLog("forceAsk: skipping every gate, asking the model now…");
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
          void gate.offer({ app_name: window.app_name, title: window.title, at });
        }
      },
    });

    devLog("observation started, interval", Math.max(2, intervalSec), "s");
    sampler.start();
    return () => {
      devLog("observation stopped");
      devRef.current = null;
      sampler.stop();
      gate.reset();
    };
  }, [enabled, intervalSec, petGate]);

  const devAvailable = import.meta.env.DEV && enabled;
  return {
    observing: enabled,
    devForceAsk: devAvailable ? () => devRef.current?.forceAsk() : null,
    devFakeBubble: devAvailable ? () => devRef.current?.fakeBubble() : null,
  };
}
