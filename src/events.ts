// Cross-window Tauri event names and payload types for the observation
// subsystem (Sprint 2). Same broadcast pattern as MOOD_EVENT in store/chat.ts.
// Pure types + constants only — safe to import from Node tests.
import type { ActiveWindow } from "./ipc/contract.ts";

/** avatar → chat: a fresh context sample, so the chat window can mirror it. */
export const CONTEXT_EVENT = "sage:context";

export interface ContextEventPayload {
  window: ActiveWindow | null;
  /** Epoch ms when the sample was taken. */
  at: number;
}

/** avatar → bubble: show this proactive remark next to the avatar. */
export const BUBBLE_EVENT = "sage:bubble";

export interface BubbleEventPayload {
  id: string;
  text: string;
  /** The heuristic trigger, for the tooltip. */
  reason: string;
}

/** bubble → chat: the user clicked the bubble — continue in the chat window. */
export const BUBBLE_OPEN_EVENT = "sage:bubble-open";

export interface BubbleOpenEventPayload {
  text: string;
  reason: string;
}

/** any window → all: settings were saved; reload your settings store. */
export const SETTINGS_EVENT = "sage:settings";

/** any window → settings: the settings window is being opened — reset the
 * draft from the store and reload pickers (models / pets / records). */
export const SETTINGS_WINDOW_OPEN_EVENT = "sage:settings-open";
