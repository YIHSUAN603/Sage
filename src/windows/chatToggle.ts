// S4.2 / S5.4 — Position companion windows next to the avatar and show them.
// The anchor is always the `avatar` window (looked up by label, so any webview
// — avatar, bubble — can call these), flipping sides near the screen edge.
import { hasTauri } from "../runtime.ts";

const GAP = 12;

type SnapSide = "right" | "top";

/** Snap `label` next to the avatar's current position and show it. */
async function showNextToAvatar(label: string, side: SnapSide, focus: boolean) {
  const { Window, PhysicalPosition, currentMonitor } = await import(
    "@tauri-apps/api/window"
  );

  const target = await Window.getByLabel(label);
  const avatar = await Window.getByLabel("avatar");
  if (!target || !avatar) return;

  const [avatarPos, avatarSize, targetSize, monitor] = await Promise.all([
    avatar.outerPosition(),
    avatar.outerSize(),
    target.outerSize(),
    currentMonitor(),
  ]);

  let x: number;
  let y: number;
  if (side === "right") {
    // To the right of the avatar, bottoms roughly aligned.
    x = avatarPos.x + avatarSize.width + GAP;
    y = avatarPos.y + avatarSize.height - targetSize.height;
  } else {
    // Above the avatar, horizontally centered.
    x = avatarPos.x + Math.round((avatarSize.width - targetSize.width) / 2);
    y = avatarPos.y - targetSize.height - GAP;
  }

  if (monitor) {
    const minX = monitor.position.x;
    const maxX = monitor.position.x + monitor.size.width;
    const minY = monitor.position.y;
    const maxY = monitor.position.y + monitor.size.height;
    // Flip to the opposite side when poking past the screen edge.
    if (side === "right" && x + targetSize.width > maxX) {
      x = avatarPos.x - targetSize.width - GAP;
    }
    if (side === "top" && y < minY) {
      y = avatarPos.y + avatarSize.height + GAP;
    }
    x = Math.max(minX, Math.min(x, maxX - targetSize.width));
    y = Math.max(minY, Math.min(y, maxY - targetSize.height));
  }

  // On Linux/WSL (GTK) a still-hidden window ignores setPosition — the WM
  // assigns its own (cascading, "random") spot when the window maps, and
  // show() resolves before the map finishes, so a single post-show setPosition
  // still races the map. Re-assert the position until outerPosition() reports
  // it stuck (capped, so it always self-terminates).
  const pos = new PhysicalPosition(Math.round(x), Math.round(y));
  await target.setPosition(pos);
  await target.show();
  if (focus) await target.setFocus();
  for (let i = 0; i < 8; i++) {
    await target.setPosition(pos);
    const now = await target.outerPosition();
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
