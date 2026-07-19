// S4.5 — Settings store: load/save wrapped around the SageIpc settings
// commands, with optimistic local state so the dialog feels instant.
// Every window runs its own store instance, so a successful save broadcasts
// SETTINGS_EVENT and the other windows reload (observation start/stop lives
// in the avatar window while the dialog lives in the chat window).
import { create } from "zustand";
import { SETTINGS_EVENT } from "../events.ts";
import { applyLanguage } from "../i18n/index.ts";
import { DEFAULT_SETTINGS, type Settings } from "../ipc/contract.ts";
import { hasTauri } from "../runtime.ts";
import { requireIpc } from "./ipc.ts";

export interface SettingsState {
  settings: Settings;
  /** true once the first getSettings round-trip finished (success or not). */
  loaded: boolean;
  saving: boolean;
  error: string | null;
  load: () => Promise<void>;
  save: (patch: Partial<Settings>) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>()((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  saving: false,
  error: null,

  async load() {
    try {
      const settings = await requireIpc().getSettings();
      set({ settings, loaded: true, error: null });
      applyLanguage(settings.language);
    } catch (err) {
      // Backend command may not be registered yet (T1 track) — keep defaults.
      set({ loaded: true, error: toMessage(err) });
    }
  },

  async save(patch) {
    const next: Settings = { ...get().settings, ...patch };
    set({ settings: next, saving: true, error: null });
    applyLanguage(next.language); // optimistic, like the rest of the state
    try {
      await requireIpc().setSettings(next);
      set({ saving: false });
      if (hasTauri()) {
        const { emit } = await import("@tauri-apps/api/event");
        void emit(SETTINGS_EVENT);
      }
    } catch (err) {
      set({ saving: false, error: toMessage(err) });
    }
  },
}));

/** Selector: does the user have an OpenRouter key pasted in yet? */
export function hasApiKey(state: SettingsState): boolean {
  return state.settings.api_key.trim().length > 0;
}

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
