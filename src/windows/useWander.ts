// The self-moving companion's animation layer. A single low-frequency scheduler
// decides *when* to stroll; a short frame loop eases the avatar window to a
// target with setPosition. Decision and animation are deliberately split: the
// LLM (via the observe/compose call) only ever hands us a MoveIntent through
// `intentRef` — this hook turns that (or a calm random wander when nothing is
// pending) into actual on-screen motion.
//
// Runs in the avatar window (the only always-visible webview, so its timers are
// never throttled). All positioning is guarded by `positioningWorks`: under a
// Wayland/WSLg compositor setPosition is a no-op, so we never even try.
import { useEffect } from "react";
import type { MutableRefObject } from "react";
import { hasTauri } from "../runtime.ts";
import type { AvatarGesture } from "./petAtlas.ts";
import {
  resolveMoveTarget,
  stepToward,
  type MoveIntent,
  type Point,
  type Rect,
} from "./wander.ts";

/** Latest AI movement decision; `seq` bumps so repeats of a direction re-fire. */
export interface MoveSignal {
  intent: MoveIntent;
  seq: number;
}

export interface WanderOptions {
  /** Master switch (wander_enabled). Off ⇒ the hook does nothing. */
  enabled: boolean;
  /** setPosition actually works here (false on Wayland/WSLg). */
  positioningWorks: MutableRefObject<boolean>;
  /** The avatar Tauri window. */
  winRef: MutableRefObject<import("@tauri-apps/api/window").Window | null>;
  /** The LogicalPosition constructor (probed once at startup). */
  logPos: MutableRefObject<typeof import("@tauri-apps/api/dpi").LogicalPosition | null>;
  /** True while we must not move (dragging, or a non-idle mood). */
  isPaused: () => boolean;
  /** Drive the run-left / run-right sprite during a stroll; null clears it. */
  setGesture: (g: AvatarGesture | null) => void;
  /** Latest AI intent to act on, or null. Consumed (cleared) once acted upon. */
  intentRef: MutableRefObject<MoveSignal | null>;
}

// Cadence. The scheduler wakes on TICK_MS to check for a pending AI intent
// (acted on promptly) or to occasionally start a calm random stroll. Random
// strolls are spaced BASE_MIN…BASE_MAX apart so an idle pet ambles, not paces.
const TICK_MS = 4_000;
const BASE_MIN_MS = 60_000;
const BASE_MAX_MS = 120_000;
// Stroll speed and frame cadence. ~180 logical px/s reads as an unhurried walk.
const SPEED_PX_PER_S = 180;
const FRAME_MS = 16;
const STEP_PX = (SPEED_PX_PER_S * FRAME_MS) / 1000;

export function useWander(opts: WanderOptions): void {
  const { enabled } = opts;

  useEffect(() => {
    if (!enabled || !hasTauri()) return;

    let disposed = false;
    let tickTimer: ReturnType<typeof setInterval> | null = null;
    let frameTimer: ReturnType<typeof setInterval> | null = null;
    let moving = false;
    let nextBaseAt = Date.now() + randBetween(BASE_MIN_MS, BASE_MAX_MS);

    const stopFrames = () => {
      if (frameTimer) clearInterval(frameTimer);
      frameTimer = null;
      moving = false;
      opts.setGesture(null);
    };

    /** Current avatar rect + monitor rect, both in logical px (null on error). */
    const geometry = async (): Promise<{ win: Rect; monitor: Rect | null } | null> => {
      const win = opts.winRef.current;
      if (!win) return null;
      const { currentMonitor } = await import("@tauri-apps/api/window");
      const [pos, size, scale, monitor] = await Promise.all([
        win.outerPosition(),
        win.outerSize(),
        win.scaleFactor(),
        currentMonitor(),
      ]);
      const winRect: Rect = { ...pos.toLogical(scale), ...size.toLogical(scale) };
      const monitorRect: Rect | null = monitor
        ? {
            ...monitor.position.toLogical(monitor.scaleFactor),
            ...monitor.size.toLogical(monitor.scaleFactor),
          }
        : null;
      return { win: winRect, monitor: monitorRect };
    };

    /** Ease the window to `target`, updating the sprite direction each frame. */
    const strollTo = (start: Point, target: Point) => {
      const LogicalPosition = opts.logPos.current;
      const win = opts.winRef.current;
      if (!LogicalPosition || !win) return;
      moving = true;
      let cur: Point = start;
      frameTimer = setInterval(() => {
        // Bail out the instant the user grabs the pet or the mood turns busy;
        // the drag path owns setPosition from here.
        if (disposed || opts.isPaused()) {
          stopFrames();
          return;
        }
        const next = stepToward(cur, target, STEP_PX);
        cur = { x: next.x, y: next.y };
        opts.setGesture(next.dir < 0 ? "run-left" : next.dir > 0 ? "run-right" : null);
        void win.setPosition(new LogicalPosition(next.x, next.y)).catch((err) => {
          if (import.meta.env.DEV) console.error("[sage:wander] setPosition failed", err);
        });
        if (next.arrived) stopFrames();
      }, FRAME_MS);
    };

    /** Decide whether/where to move this tick and kick off a stroll if so. */
    const tick = async () => {
      if (disposed || moving) return;
      if (!opts.positioningWorks.current || opts.isPaused()) return;

      // An AI intent takes priority and fires promptly; otherwise stroll only
      // on the slow base cadence, and always with a fresh random spot.
      const signal = opts.intentRef.current;
      const now = Date.now();
      let intent: MoveIntent;
      if (signal) {
        opts.intentRef.current = null; // consume it
        intent = signal.intent;
      } else if (now >= nextBaseAt) {
        intent = "wander";
      } else {
        return;
      }
      nextBaseAt = now + randBetween(BASE_MIN_MS, BASE_MAX_MS);
      if (intent === "stay") return;

      // Don't wander onto a screen the user isn't looking at, or over an open
      // chat window (its snap spot doesn't follow us).
      if (await chatVisible()) return;
      const geo = await geometry();
      if (disposed || !geo || opts.isPaused()) return;
      const target = resolveMoveTarget(intent, geo.win, geo.monitor);
      if (!target) return;
      strollTo({ x: geo.win.x, y: geo.win.y }, target);
    };

    tickTimer = setInterval(() => void tick(), TICK_MS);

    return () => {
      disposed = true;
      if (tickTimer) clearInterval(tickTimer);
      stopFrames();
    };
  }, [enabled]);
}

function randBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** Whether the chat window is currently showing (best-effort; false on error). */
async function chatVisible(): Promise<boolean> {
  try {
    const { Window } = await import("@tauri-apps/api/window");
    const chat = await Window.getByLabel("chat");
    return chat ? await chat.isVisible() : false;
  } catch {
    return false;
  }
}
