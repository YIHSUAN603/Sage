// Codex pet spritesheet geometry + animation timing, shared by PetSprite and
// its tests. Source: OpenAI hatch-pet skill `references/animation-rows.md`.
// The atlas is a 1536×1872 image laid out as 8 columns × 9 rows of 192×208
// cells; each row is one animation whose per-frame durations (ms) are below.
import type { AvatarMood } from "../store/chat.ts";

export const ATLAS = {
  cols: 8,
  rows: 9,
  cellW: 192,
  cellH: 208,
  sheetW: 1536,
  sheetH: 1872,
} as const;

export interface AtlasRow {
  name: string;
  /** Per-frame durations in ms; its length is the frame count for this row. */
  durations: number[];
}

// Row index = row order in the sheet (top to bottom).
export const ROWS: AtlasRow[] = [
  { name: "idle", durations: [280, 110, 110, 140, 140, 320] },
  { name: "running-right", durations: [120, 120, 120, 120, 120, 120, 120, 220] },
  { name: "running-left", durations: [120, 120, 120, 120, 120, 120, 120, 220] },
  { name: "waving", durations: [140, 140, 140, 280] },
  { name: "jumping", durations: [140, 140, 140, 140, 280] },
  { name: "failed", durations: [140, 140, 140, 140, 140, 140, 140, 240] },
  { name: "waiting", durations: [150, 150, 150, 150, 150, 260] },
  { name: "running", durations: [120, 120, 120, 120, 120, 220] },
  { name: "review", durations: [150, 150, 150, 150, 150, 280] },
];

// Sage only has three moods; map each to the row that best fits.
// idle → idle (float), thinking → waiting (pondering), talking → waving (greet).
export const MOOD_ROW: Record<AvatarMood, number> = {
  idle: 0,
  thinking: 6,
  talking: 3,
};

/** Row index for a mood, clamped into range so a bad map entry never breaks. */
export function rowForMood(mood: AvatarMood): number {
  const row = MOOD_ROW[mood] ?? 0;
  return row >= 0 && row < ROWS.length ? row : 0;
}
