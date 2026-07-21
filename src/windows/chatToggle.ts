// S4.2 / S5.4 — Position companion windows next to the avatar and show them.
// The anchor is always the `avatar` window (looked up by label, so any webview
// — avatar, bubble — can call these), flipping sides near the screen edge.
// All geometry runs in LOGICAL pixels: physical coordinates are scaled per
// monitor, so mixing them breaks when the avatar sits on a screen with a
// different scale factor than the target window (mixed-DPI multi-monitor).
import { hasTauri } from "../runtime.ts";
import { computeSnapPosition, type SnapSide } from "./snapPosition.ts";

/** Compute `target`'s snap spot next to the avatar and move it there.
 * Returns the logical position it settled on, or null when a window is
 * missing. */
async function placeNextToAvatar(
  target: import("@tauri-apps/api/window").Window,
  side: SnapSide,
): Promise<import("@tauri-apps/api/dpi").LogicalPosition | null> {
  const { Window, LogicalPosition, currentMonitor } = await import(
    "@tauri-apps/api/window"
  );

  const avatar = await Window.getByLabel("avatar");
  if (!avatar) return null;

  const [avatarPos, avatarSize, avatarScale, targetSize, targetScale, monitor] =
    await Promise.all([
      avatar.outerPosition(),
      avatar.outerSize(),
      avatar.scaleFactor(),
      target.outerSize(),
      target.scaleFactor(),
      currentMonitor(),
    ]);

  const avatarRect = {
    ...avatarPos.toLogical(avatarScale),
    ...avatarSize.toLogical(avatarScale),
  };
  const monitorRect = monitor
    ? {
        ...monitor.position.toLogical(monitor.scaleFactor),
        ...monitor.size.toLogical(monitor.scaleFactor),
      }
    : null;
  const { x, y } = computeSnapPosition(
    avatarRect,
    targetSize.toLogical(targetScale),
    monitorRect,
    side,
  );

  const pos = new LogicalPosition(x, y);
  await target.setPosition(pos);
  return pos;
}

/** Snap `label` next to the avatar's current position and show it. */
async function showNextToAvatar(label: string, side: SnapSide, focus: boolean) {
  const { Window } = await import("@tauri-apps/api/window");
  const target = await Window.getByLabel(label);
  if (!target) return;

  // On Linux/WSL (GTK) a still-hidden window ignores setPosition — the WM
  // assigns its own (cascading, "random") spot when the window maps, and
  // show() resolves before the map finishes, so a single post-show setPosition
  // still races the map. Re-assert the position until outerPosition() reports
  // it stuck (capped, so it always self-terminates).
  const pos = await placeNextToAvatar(target, side);
  if (!pos) return;
  await target.show();
  if (focus) await target.setFocus();
  for (let i = 0; i < 8; i++) {
    await target.setPosition(pos);
    // Compare in logical px; re-read the scale factor each round since it
    // changes once the window lands on a different-DPI monitor.
    const now = (await target.outerPosition()).toLogical(await target.scaleFactor());
    if (Math.abs(now.x - pos.x) <= 2 && Math.abs(now.y - pos.y) <= 2) break;
    await new Promise((r) => setTimeout(r, 16));
  }
}

/** Re-assert the avatar's always-on-top so it comes back to the top layer.
 * Best-effort: never let a raise failure suppress the bubble itself. */
async function raiseAvatar() {
  try {
    const { Window } = await import("@tauri-apps/api/window");
    const avatar = await Window.getByLabel("avatar");
    if (!avatar) return;
    await avatar.setAlwaysOnTop(false);
    await avatar.setAlwaysOnTop(true);
  } catch (err) {
    console.warn("[sage] raiseAvatar failed", err);
  }
}

/** Show the chat bubble snapped next to the avatar (no-op outside Tauri). */
export async function showChatWindow(): Promise<void> {
  if (!hasTauri()) {
    console.info("[sage] 純瀏覽器開發：chat 視窗需在 Tauri 內執行");
    return;
  }
  await showNextToAvatar("chat", "right", true);
}

/** Show the proactive speech bubble above the avatar, without stealing focus. */
export async function showBubbleWindow(): Promise<void> {
  if (!hasTauri()) return;
  await raiseAvatar();
  await showNextToAvatar("bubble", "top", false);
}

/** Re-snap the bubble above the avatar if it's currently showing — called by
 * the avatar window whenever it moves, so the bubble follows the pet. */
export async function syncBubblePosition(): Promise<void> {
  if (!hasTauri()) return;
  const { Window } = await import("@tauri-apps/api/window");
  const bubble = await Window.getByLabel("bubble");
  if (!bubble || !(await bubble.isVisible())) return;
  await placeNextToAvatar(bubble, "top");
}

export async function toggleChatWindow(): Promise<void> {
  if (!hasTauri()) {
    console.info("[sage] 純瀏覽器開發：chat 視窗 toggle 需在 Tauri 內執行");
    return;
  }
  const { Window } = await import("@tauri-apps/api/window");
  const chat = await Window.getByLabel("chat");
  if (!chat) return;

  if (await chat.isVisible()) {
    await chat.hide();
    return;
  }
  await showNextToAvatar("chat", "right", true);
}
