// S5.1/S5.3/S5.4 glue — runs in the avatar window (the only always-visible
// webview, so its timers are never throttled). Wires sampler → observation
// store + cross-window context broadcast + a time-driven bubble gate, honoring
// two independent switches: observe_enabled drives sampling/snapshot reads
// (off ⇒ nothing is ever captured); proactive_enabled drives the bubble
// cadence (with observation the prompt carries context, without it it's a
// see-nothing small-talk prompt; observe-only ⇒ silent sampling for chat
// context, no bubbles). Asks are skipped while the user is away from the
// keyboard.
import { useEffect, useRef } from "react";
import {
  BUBBLE_EVENT,
  CONTEXT_EVENT,
  type BubbleEventPayload,
  type ContextEventPayload,
} from "../events.ts";
import i18n from "../i18n/index.ts";
import type { AgentActivity } from "../ipc/contract.ts";
import { hasTauri } from "../runtime.ts";
import { requireIpc } from "../store/ipc.ts";
import { useObservationStore } from "../store/observation.ts";
import { useSettingsStore } from "../store/settings.ts";
import { showBubbleWindow } from "../windows/chatToggle.ts";
import { proactiveTuning } from "../store/persona.ts";
import { buildMemoryIndexMessage } from "../memory/context.ts";
import { createBubbleGate } from "./gate.ts";
import { IDLE_SKIP_SECONDS, shouldSkipWhenIdle } from "./idle.ts";
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

/**
 * A coding-agent state change worth reacting to right away: the agent is now
 * waiting for the user's permission, or it just finished a turn (running →
 * idle). Everything else (mid-turn tool churn, staying idle) rides the normal
 * cadence instead, so the companion doesn't natter at every log line.
 */
function agentTransitionWorthAsking(
  prev: AgentActivity | null,
  now: AgentActivity,
): boolean {
  const wasSame = prev?.session === now.session;
  if (now.state === "waiting_permission") {
    return !wasSame || prev?.state !== "waiting_permission";
  }
  if (now.state === "idle") {
    return wasSame && prev?.state === "running";
  }
  return false;
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

/**
 * Drive the proactive subsystem from two independent switches: observation
 * (`observe_enabled`) runs the window sampler; proactive chatter
 * (`proactive_enabled`) runs the bubble cadence, with or without observed
 * context. Both are gated on settings having loaded, so a default-on switch
 * never fires off stale defaults before the real values arrive.
 */
export function useObservation(): ObservationHandle {
  const observeEnabled = useSettingsStore((s) => s.settings.observe_enabled);
  const proactiveEnabled = useSettingsStore((s) => s.settings.proactive_enabled);
  const agentsEnabled = useSettingsStore((s) => s.settings.observe_agents);
  const loaded = useSettingsStore((s) => s.loaded);
  const intervalSec = useSettingsStore((s) => s.settings.observe_interval);
  const devRef = useRef<DevHelpers | null>(null);

  const enabled = observeEnabled && loaded;
  const proactive = proactiveEnabled && loaded;
  const agents = agentsEnabled && loaded;

  useEffect(() => {
    if (!enabled && !proactive && !agents) return;
    const ipc = requireIpc();

    // When each bubble was shown — drives the maxPerHour quota.
    let bubbleTimes: number[] = [];
    // Freshest coding-agent activity, kept by the poller below and read by the
    // gate at ask time. Null until the first poll (or when agents off).
    let latestAgent: AgentActivity | null = null;

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
      idle: !enabled,
      runObserve: createRunObserve(ipc, () => useSettingsStore.getState().settings),
      onBubble: presentBubble,
      // Read-only long-term memory: give the proactive prompts the same memory
      // index that chat.ts injects (no save/recall/forget tools). Resolved per
      // ask so a settings toggle / new memories take effect next cadence.
      memoryPrefix: async () => {
        if (!useSettingsStore.getState().settings.memory_enabled) return null;
        try {
          return buildMemoryIndexMessage(await ipc.listMemories());
        } catch {
          return null;
        }
      },
      // Coding-agent activity rides into both gate stages when agent
      // observation is on; the poller below keeps `latestAgent` fresh.
      agentActivity: agents ? async () => latestAgent : undefined,
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

    // Window sampling exists only for observation — idle chatter must not
    // touch the active window at all (that's the whole privacy point).
    const sampler = enabled
      ? createSampler({
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
        })
      : null;

    // Time-driven asks (proactive chatter only): look immediately when the
    // loop starts (chatter just turned on / app launched ⇒ a hello), then on
    // the cooldown-derived random cadence. The model's SILENT reply filters
    // content; the maxPerHour quota skips the ask (and its LLM call) entirely
    // once enough bubbles surfaced within the rolling hour.
    const askReasonKey = enabled ? "gate.observeReason" : "gate.idleReason";
    let askTimer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    // One guarded ask: skip if nobody's at the keyboard (no one to talk to) or
    // the hourly bubble quota is spent — both save the LLM call. Shared by the
    // time-driven cadence and the coding-agent reactive trigger. activityState
    // never rejects per the contract; treat a failure as "active" just in case.
    const guardedAsk = async (reason: string): Promise<void> => {
      let idleSeconds = 0;
      try {
        idleSeconds = (await ipc.activityState()).idle_seconds;
      } catch {
        idleSeconds = 0;
      }
      if (shouldSkipWhenIdle(idleSeconds)) {
        devLog("ask skipped: user idle for", idleSeconds, "s (threshold", IDLE_SKIP_SECONDS, "s)");
        return;
      }
      const { maxPerHour } = await proactiveTuning();
      if (!underHourlyQuota(bubbleTimes, Date.now(), maxPerHour)) {
        devLog("ask skipped: hourly bubble quota reached (max", maxPerHour, "/h)");
        return;
      }
      await gate.forceAsk(reason);
    };

    // Time-driven asks (proactive chatter only): look immediately when the loop
    // starts, then on the cooldown-derived random cadence.
    const runAsk = async () => {
      await guardedAsk(i18n.t(askReasonKey, { ns: "prompt" }));
      const delay = await nextAskDelay();
      if (stopped) return;
      askTimer = setTimeout(() => void runAsk(), delay);
    };

    // Coding-agent reactive trigger: poll agent_activity; on a high-value
    // transition (the agent just finished a turn, or is waiting for the user's
    // permission) fire one guarded ask so the companion reacts in near-real
    // time rather than only on the slow cadence. The gate still reads the room
    // and may stay SILENT; the quota still caps how often it actually bubbles.
    let agentTimer: ReturnType<typeof setTimeout> | null = null;
    let prevAgent: AgentActivity | null = null;
    const AGENT_POLL_MS = import.meta.env.DEV ? 1_500 : 3_000;
    const pollAgent = async () => {
      try {
        latestAgent = await ipc.agentActivity();
      } catch {
        latestAgent = null;
      }
      const now = latestAgent;
      if (proactive && now && agentTransitionWorthAsking(prevAgent, now)) {
        const reasonKey =
          now.state === "waiting_permission"
            ? "gate.agentWaitingReason"
            : "gate.agentFinishedReason";
        void guardedAsk(i18n.t(reasonKey, { ns: "prompt", source: now.source }));
      }
      prevAgent = now;
      if (stopped) return;
      agentTimer = setTimeout(() => void pollAgent(), AGENT_POLL_MS);
    };

    if (enabled) {
      devLog(
        proactive
          ? "observation started, interval"
          : "silent observation started (no bubbles), interval",
        Math.max(2, intervalSec),
        "s",
      );
    } else {
      devLog("idle chatter started (observation off — nothing is captured)");
    }
    sampler?.start();
    if (proactive) {
      askTimer = setTimeout(() => void runAsk(), 0);
    }
    if (agents) {
      devLog("coding-agent observation started, poll", AGENT_POLL_MS, "ms");
      agentTimer = setTimeout(() => void pollAgent(), 0);
    }
    return () => {
      devLog(enabled ? "observation stopped" : "idle chatter stopped");
      devRef.current = null;
      stopped = true;
      if (askTimer) clearTimeout(askTimer);
      if (agentTimer) clearTimeout(agentTimer);
      sampler?.stop();
      gate.reset();
    };
  }, [enabled, proactive, agents, intervalSec]);

  const devAvailable = import.meta.env.DEV && (enabled || proactive);
  return {
    observing: enabled,
    devForceAsk: devAvailable ? () => devRef.current?.forceAsk() : null,
    devFakeBubble: devAvailable ? () => devRef.current?.fakeBubble() : null,
  };
}
