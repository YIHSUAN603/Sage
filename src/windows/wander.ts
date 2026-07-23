// Pure geometry + intent parsing for the self-moving companion (autonomous
// "wander"). Two concerns, both side-effect free so they can be unit-tested
// without a window:
//   • parseMoveTag  — pull a trailing `MOVE: <intent>` line off a model reply,
//                     returning the remaining text + the decoded intent. The
//                     model rides the existing observe/compose call and appends
//                     one of a tiny vocabulary; it never emits pixels.
//   • resolveMoveTarget — turn an intent into a concrete top-left position for
//                     the avatar window, clamped fully inside the monitor.
//   • stepToward    — one frame of easing toward a target (for the RAF loop).
// All coordinates are LOGICAL pixels, matching snapPosition.ts — mixing
// physical values across monitors breaks on mixed-DPI setups.

/** The movement vocabulary the model may pick from. Anything else ⇒ "stay". */
export type MoveIntent = "left" | "right" | "wander" | "corner" | "center" | "stay";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

const MOVE_INTENTS: readonly MoveIntent[] = [
  "left",
  "right",
  "wander",
  "corner",
  "center",
  "stay",
];

/** Keep the window this far from the monitor edge for corner/wander spots. */
const EDGE_MARGIN = 24;

/** Matches a whole line that is just `MOVE: <word>` (case-insensitive). */
const MOVE_LINE = /^\s*MOVE\s*:\s*([A-Za-z-]+)\s*$/i;

/**
 * Split a compose reply into its spoken text and a movement intent. Every line
 * that is a bare `MOVE: <intent>` tag is stripped from the text; the last valid
 * one wins. A missing/unknown tag yields "stay" — the model chose not to move,
 * or garbled it, and a still pet is always the safe default. The remaining text
 * is returned verbatim (trimmed) so the caller keeps its own SILENT handling.
 */
export function parseMoveTag(reply: string): { text: string; intent: MoveIntent } {
  const kept: string[] = [];
  let intent: MoveIntent = "stay";
  for (const line of reply.split(/\r?\n/)) {
    const m = line.match(MOVE_LINE);
    if (m) {
      const word = m[1].toLowerCase();
      if ((MOVE_INTENTS as readonly string[]).includes(word)) {
        intent = word as MoveIntent;
      }
      continue; // drop the tag line from the spoken text either way
    }
    kept.push(line);
  }
  return { text: kept.join("\n").trim(), intent };
}

/** Clamp a top-left position so the whole window stays within the monitor. */
function clampPos(x: number, y: number, win: Rect, monitor: Rect | null): Point {
  if (!monitor) return { x: Math.round(x), y: Math.round(y) };
  const maxX = monitor.x + monitor.width - win.width;
  const maxY = monitor.y + monitor.height - win.height;
  // max(min, min(x, max)) keeps it in range even when the window is larger than
  // the monitor (max < min) — it then pins to the monitor origin.
  return {
    x: Math.round(Math.max(monitor.x, Math.min(x, maxX))),
    y: Math.round(Math.max(monitor.y, Math.min(y, maxY))),
  };
}

/**
 * Resolve a movement intent into a target top-left for the avatar window.
 * Returns null when there's nothing to do — "stay", or an intent that needs
 * monitor bounds we don't have (corner/center/wander with no monitor). The
 * left/right nudge still works monitor-less (relative move, unclamped). `rng`
 * is injectable so the randomized intents are testable.
 */
export function resolveMoveTarget(
  intent: MoveIntent,
  win: Rect,
  monitor: Rect | null,
  rng: () => number = Math.random,
): Point | null {
  switch (intent) {
    case "stay":
      return null;

    case "left":
    case "right": {
      // Nudge horizontally by ~18–40% of the monitor width (a sensible fixed
      // span when we don't know the monitor). y is unchanged, then clamped.
      const span = monitor ? monitor.width : 800;
      const step = Math.round(span * (0.18 + rng() * 0.22));
      const dir = intent === "left" ? -1 : 1;
      return clampPos(win.x + dir * step, win.y, win, monitor);
    }

    case "center": {
      if (!monitor) return null;
      return clampPos(
        monitor.x + (monitor.width - win.width) / 2,
        monitor.y + (monitor.height - win.height) / 2,
        win,
        monitor,
      );
    }

    case "corner": {
      if (!monitor) return null;
      const left = rng() < 0.5;
      const top = rng() < 0.5;
      const x = left
        ? monitor.x + EDGE_MARGIN
        : monitor.x + monitor.width - win.width - EDGE_MARGIN;
      const y = top
        ? monitor.y + EDGE_MARGIN
        : monitor.y + monitor.height - win.height - EDGE_MARGIN;
      return clampPos(x, y, win, monitor);
    }

    case "wander": {
      if (!monitor) return null;
      const freeX = Math.max(0, monitor.width - win.width - 2 * EDGE_MARGIN);
      const freeY = Math.max(0, monitor.height - win.height - 2 * EDGE_MARGIN);
      return clampPos(
        monitor.x + EDGE_MARGIN + rng() * freeX,
        monitor.y + EDGE_MARGIN + rng() * freeY,
        win,
        monitor,
      );
    }
  }
}

/**
 * One frame of movement toward a target. Moves at most `maxStep` px along the
 * straight line; snaps to the target (arrived) once within reach. `dir` is the
 * horizontal sign BEFORE the step (−1 left, +1 right, 0 none) so the caller can
 * pick the run-left / run-right sprite.
 */
export function stepToward(
  cur: Point,
  target: Point,
  maxStep: number,
): { x: number; y: number; arrived: boolean; dir: -1 | 0 | 1 } {
  const dx = target.x - cur.x;
  const dy = target.y - cur.y;
  const dist = Math.hypot(dx, dy);
  const dir: -1 | 0 | 1 = dx < -0.5 ? -1 : dx > 0.5 ? 1 : 0;
  if (dist <= maxStep || dist === 0) {
    return { x: Math.round(target.x), y: Math.round(target.y), arrived: true, dir };
  }
  const ratio = maxStep / dist;
  return {
    x: Math.round(cur.x + dx * ratio),
    y: Math.round(cur.y + dy * ratio),
    arrived: false,
    dir,
  };
}
