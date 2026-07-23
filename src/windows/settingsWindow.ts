// Open (or focus) the standalone settings window. Same show/focus pattern as
// chatToggle.ts, minus the avatar-snapping geometry — this is a regular
// decorated window declared in tauri.conf.json (visible:false at boot).
import { SETTINGS_WINDOW_OPEN_EVENT } from "../events.ts";
import { hasTauri } from "../runtime.ts";

export async function openSettingsWindow(): Promise<void> {
  if (!hasTauri()) {
    // Pure-browser dev: the settings route still works as a separate tab.
    window.open("/?window=settings", "_blank");
    return;
  }
  const { Window } = await import("@tauri-apps/api/window");
  const target = await Window.getByLabel("settings");
  if (!target) return;

  // Tell the (always-alive) settings webview it's being opened, so it resets
  // its draft from the store and reloads pickers — before it becomes visible.
  const { emit } = await import("@tauri-apps/api/event");
  await emit(SETTINGS_WINDOW_OPEN_EVENT);

  if (await target.isVisible()) {
    await target.unminimize();
    await target.setFocus();
    return;
  }
  await target.show();
  await target.setFocus();
}
