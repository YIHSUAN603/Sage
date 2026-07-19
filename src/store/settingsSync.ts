// Reload this window's settings store whenever any window broadcasts a save
// (store/settings.ts emits SETTINGS_EVENT). Mount once per window.
import { useEffect } from "react";
import { SETTINGS_EVENT } from "../events.ts";
import { hasTauri } from "../runtime.ts";
import { useSettingsStore } from "./settings.ts";

export function useSettingsSync(): void {
  useEffect(() => {
    if (!hasTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const off = await listen(SETTINGS_EVENT, () => {
        void useSettingsStore.getState().load();
      });
      if (disposed) off();
      else unlisten = off;
    })();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
}
