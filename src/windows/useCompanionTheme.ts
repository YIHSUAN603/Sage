// Applies the companion-derived palette to this window. Mounted once in
// App.tsx so all three windows (avatar / chat / bubble) re-theme together.
// Precedence: pet.json `sage.theme.accent` → auto-extracted spritesheet hue
// → (no pet / failure) App.css's default sage green.
import { useEffect } from "react";
import { requireIpc } from "../store/ipc.ts";
import { useSettingsStore } from "../store/settings.ts";
import {
  type Accent,
  deriveThemeCss,
  extractAccent,
  parseAccentHex,
} from "./companionTheme.ts";

const STYLE_ID = "companion-theme";
const SAMPLE_SIZE = 64;

function applyTheme(accent: Accent | null): void {
  const existing = document.getElementById(STYLE_ID);
  if (!accent) {
    existing?.remove();
    return;
  }
  let el = existing as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = deriveThemeCss(accent);
}

/** Decode the atlas data URL and downsample it to a small RGBA buffer. */
async function samplePixels(dataUrl: string): Promise<Uint8ClampedArray | null> {
  const img = new Image();
  img.src = dataUrl;
  try {
    await img.decode();
  } catch {
    return null;
  }
  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE_SIZE;
  canvas.height = SAMPLE_SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
  return ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;
}

export function useCompanionTheme(): void {
  const activePet = useSettingsStore((s) => s.settings.active_pet);
  useEffect(() => {
    let cancelled = false;
    const id = activePet.trim();
    if (!id) {
      applyTheme(null);
      return;
    }
    void (async () => {
      let accent: Accent | null = null;
      try {
        const ipc = requireIpc();
        const pet = await ipc.readPet(id);
        if (pet.theme?.accent) accent = parseAccentHex(pet.theme.accent);
        if (!accent) {
          const pixels = await samplePixels(await ipc.readPetAtlas(id));
          if (pixels) accent = extractAccent(pixels);
        }
      } catch {
        accent = null;
      }
      if (!cancelled) applyTheme(accent);
    })();
    return () => {
      cancelled = true;
    };
  }, [activePet]);
}
