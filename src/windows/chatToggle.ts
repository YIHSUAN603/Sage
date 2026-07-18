// S4.2 — Toggle the chat bubble from the avatar: show it snapped next to
// the avatar's current position (flipping sides near the screen edge), or
// hide it when it is already visible.
import { hasTauri } from "../runtime.ts";

const GAP = 12;

export async function toggleChatWindow(): Promise<void> {
  if (!hasTauri()) {
    console.info("[sage] 純瀏覽器開發：chat 視窗 toggle 需在 Tauri 內執行");
    return;
  }
  const { Window, PhysicalPosition, currentMonitor, getCurrentWindow } =
    await import("@tauri-apps/api/window");

  const chat = await Window.getByLabel("chat");
  if (!chat) return;

  if (await chat.isVisible()) {
    await chat.hide();
    return;
  }

  const avatar = getCurrentWindow();
  const [avatarPos, avatarSize, chatSize, monitor] = await Promise.all([
    avatar.outerPosition(),
    avatar.outerSize(),
    chat.outerSize(),
    currentMonitor(),
  ]);

  // Default: to the right of the avatar, bottoms roughly aligned.
  let x = avatarPos.x + avatarSize.width + GAP;
  let y = avatarPos.y + avatarSize.height - chatSize.height;

  if (monitor) {
    const minX = monitor.position.x;
    const maxX = monitor.position.x + monitor.size.width;
    const minY = monitor.position.y;
    const maxY = monitor.position.y + monitor.size.height;
    // Flip to the left side when the bubble would poke past the screen edge.
    if (x + chatSize.width > maxX) x = avatarPos.x - chatSize.width - GAP;
    x = Math.max(minX, Math.min(x, maxX - chatSize.width));
    y = Math.max(minY, Math.min(y, maxY - chatSize.height));
  }

  await chat.setPosition(new PhysicalPosition(Math.round(x), Math.round(y)));
  await chat.show();
  await chat.setFocus();
}
