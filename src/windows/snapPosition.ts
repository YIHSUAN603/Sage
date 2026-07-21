// Pure geometry for snapping a companion window (chat / bubble) next to the
// avatar. All inputs and the result are in LOGICAL pixels — mixing physical
// coordinates across monitors breaks on mixed-DPI setups (e.g. a Retina
// MacBook screen + a 1x external display), because each window/monitor
// converts physical values with its own scale factor.

const GAP = 12;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export type SnapSide = "right" | "top";

/** Compute where `target` should sit next to the avatar: to the right with
 * bottoms aligned, or above and horizontally centered. Near a screen edge the
 * spot flips to the opposite side, then gets clamped into the monitor. */
export function computeSnapPosition(
  avatar: Rect,
  target: Size,
  monitor: Rect | null,
  side: SnapSide,
): { x: number; y: number } {
  let x: number;
  let y: number;
  if (side === "right") {
    x = avatar.x + avatar.width + GAP;
    y = avatar.y + avatar.height - target.height;
  } else {
    x = avatar.x + Math.round((avatar.width - target.width) / 2);
    y = avatar.y - target.height - GAP;
  }

  if (monitor) {
    const minX = monitor.x;
    const maxX = monitor.x + monitor.width;
    const minY = monitor.y;
    const maxY = monitor.y + monitor.height;
    // Flip to the opposite side when poking past the screen edge.
    if (side === "right" && x + target.width > maxX) {
      x = avatar.x - target.width - GAP;
    }
    if (side === "top" && y < minY) {
      y = avatar.y + avatar.height + GAP;
    }
    x = Math.max(minX, Math.min(x, maxX - target.width));
    y = Math.max(minY, Math.min(y, maxY - target.height));
  }

  return { x: Math.round(x), y: Math.round(y) };
}
