// S4.5 — Observation store skeleton (Sprint 2). observe/sampler.ts (S5.1)
// will feed recent context snapshots in; observe/gate.ts (S5.3) will push
// proactive speech bubbles. UI only reads and dismisses.
import { create } from "zustand";
import type { ActiveWindow } from "../ipc/contract.ts";

export interface ContextSnapshot {
  window: ActiveWindow | null;
  /** Epoch ms when the sample was taken. */
  at: number;
}

/** A proactive "worth mentioning" bubble queued next to the avatar. */
export interface SpeechBubble {
  id: string;
  text: string;
  /** Why the gate decided to speak up (for the debug view / tooltip). */
  reason?: string;
  createdAt: number;
}

export interface ObservationState {
  /** Most recent context samples, oldest first (bounded ring). */
  recent: ContextSnapshot[];
  /** Pending proactive bubbles, oldest first. */
  bubbles: SpeechBubble[];
  pushContext: (window: ActiveWindow | null, at?: number) => void;
  pushBubble: (text: string, reason?: string) => void;
  dismissBubble: (id: string) => void;
  clear: () => void;
}

const RECENT_LIMIT = 20;

export const useObservationStore = create<ObservationState>()((set) => ({
  recent: [],
  bubbles: [],

  pushContext(window, at = Date.now()) {
    set((state) => ({
      recent: [...state.recent, { window, at }].slice(-RECENT_LIMIT),
    }));
  },

  pushBubble(text, reason) {
    const bubble: SpeechBubble = {
      id: crypto.randomUUID(),
      text,
      reason,
      createdAt: Date.now(),
    };
    set((state) => ({ bubbles: [...state.bubbles, bubble] }));
  },

  dismissBubble(id) {
    set((state) => ({ bubbles: state.bubbles.filter((b) => b.id !== id) }));
  },

  clear() {
    set({ recent: [], bubbles: [] });
  },
}));
