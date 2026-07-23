// Companion-driven theming: derive the window palette from the active pet.
// Pure logic only (no DOM) so Node tests can cover it — the canvas sampling
// and <style> injection live in useCompanionTheme.ts.
//
// The palette keeps App.css's lightness/structure and swaps in the pet's hue,
// so contrast stays safe in both light and dark schemes regardless of sprite.

/** An accent color as HSL hue (0–360) + saturation (0–100). */
export interface Accent {
  h: number;
  s: number;
}

/** Saturation bounds for derived UI colors — keeps neon sprites tasteful. */
const SAT_MIN = 18;
const SAT_MAX = 45;

// Pixels below these thresholds don't vote in extractAccent: mostly
// transparent, near-gray (hue meaningless), or near-black/white outlines.
const MIN_ALPHA = 128;
const MIN_SAT = 0.15;
const MIN_LIGHT = 0.08;
const MAX_LIGHT = 0.95;

const HUE_BUCKETS = 24; // 15° per bucket

interface Hsl {
  h: number; // 0–360
  s: number; // 0–1
  l: number; // 0–1
}

function rgbToHsl(r: number, g: number, b: number): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const c = max - min;
  const l = (max + min) / 2;
  const s = c === 0 ? 0 : c / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (c > 0) {
    if (max === rn) h = ((gn - bn) / c + 6) % 6;
    else if (max === gn) h = (bn - rn) / c + 2;
    else h = (rn - gn) / c + 4;
    h *= 60;
  }
  return { h, s, l };
}

/** Parse `#rgb` / `#rrggbb` into an Accent; null when malformed. */
export function parseAccentHex(hex: string): Accent | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let digits = m[1];
  if (digits.length === 3) {
    digits = digits
      .split("")
      .map((d) => d + d)
      .join("");
  }
  const r = parseInt(digits.slice(0, 2), 16);
  const g = parseInt(digits.slice(2, 4), 16);
  const b = parseInt(digits.slice(4, 6), 16);
  const { h, s } = rgbToHsl(r, g, b);
  return { h, s: s * 100 };
}

/**
 * Pick the dominant hue of an RGBA pixel buffer (as from getImageData).
 * Builds a hue histogram weighted by saturation×alpha so a colorful body
 * outvotes outlines and shading; returns null when nothing colorful exists
 * (fully transparent / grayscale sprite) so callers keep the default theme.
 */
export function extractAccent(pixels: Uint8ClampedArray): Accent | null {
  const weight = new Array<number>(HUE_BUCKETS).fill(0);
  const hueSum = new Array<number>(HUE_BUCKETS).fill(0);
  const satSum = new Array<number>(HUE_BUCKETS).fill(0);

  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const a = pixels[i + 3];
    if (a < MIN_ALPHA) continue;
    const { h, s, l } = rgbToHsl(pixels[i], pixels[i + 1], pixels[i + 2]);
    if (s < MIN_SAT || l < MIN_LIGHT || l > MAX_LIGHT) continue;
    const w = (a / 255) * s;
    const bucket = Math.min(Math.floor(h / (360 / HUE_BUCKETS)), HUE_BUCKETS - 1);
    weight[bucket] += w;
    hueSum[bucket] += w * h;
    satSum[bucket] += w * s;
  }

  let best = 0;
  for (let b = 1; b < HUE_BUCKETS; b++) {
    if (weight[b] > weight[best]) best = b;
  }
  if (weight[best] <= 0) return null;
  return {
    h: hueSum[best] / weight[best],
    s: (satSum[best] / weight[best]) * 100,
  };
}

// Each entry mirrors an App.css variable: same lightness (and roughly the same
// saturation tier) as the sage-green original, re-hued to the accent. Entries
// with `accentSat` use the clamped sprite saturation (the strong accent vars).
interface VarSpec {
  name: string;
  sat?: number;
  accentSat?: true;
  light: number;
  alpha?: number;
}

const LIGHT_VARS: VarSpec[] = [
  { name: "--leaf", accentSat: true, light: 54 },
  { name: "--leaf-deep", accentSat: true, light: 41 },
  { name: "--leaf-mist", sat: 32, light: 91 },
  { name: "--ink", sat: 12, light: 20 },
  { name: "--ink-soft", sat: 7, light: 43 },
  { name: "--on-accent", sat: 39, light: 96 },
  { name: "--bubble-bg", sat: 45, light: 97 },
  { name: "--bubble-border", sat: 22, light: 86 },
  { name: "--head-bg", sat: 27, light: 94 },
  { name: "--assistant-bg", sat: 32, light: 91 },
  { name: "--card-bg", sat: 31, light: 95 },
  { name: "--pre-bg", sat: 25, light: 92 },
  { name: "--hover-bg", accentSat: true, light: 41, alpha: 0.12 },
];

const DARK_VARS: VarSpec[] = [
  { name: "--leaf-mist", sat: 17, light: 21 },
  { name: "--ink", sat: 25, light: 90 },
  { name: "--ink-soft", sat: 12, light: 65 },
  { name: "--bubble-bg", sat: 13, light: 15 },
  { name: "--bubble-border", sat: 13, light: 24 },
  { name: "--head-bg", sat: 13, light: 18 },
  { name: "--assistant-bg", sat: 17, light: 21 },
  { name: "--card-bg", sat: 13, light: 18 },
  { name: "--pre-bg", sat: 10, light: 14 },
  { name: "--input-bg", sat: 10, light: 14 },
  { name: "--hover-bg", sat: 29, light: 70, alpha: 0.14 },
];

function renderVars(specs: VarSpec[], h: number, accentSat: number): string {
  return specs
    .map((v) => {
      const s = v.accentSat ? accentSat : (v.sat ?? 0);
      const color =
        v.alpha === undefined
          ? `hsl(${h} ${s}% ${v.light}%)`
          : `hsl(${h} ${s}% ${v.light}% / ${v.alpha})`;
      return `  ${v.name}: ${color};`;
    })
    .join("\n");
}

/**
 * CSS text overriding App.css's palette (light + dark blocks) with the
 * accent's hue. `--error-*`, `--input-bg` (light) and the stop-button reds
 * stay untouched.
 */
export function deriveThemeCss(accent: Accent): string {
  const h = Math.round(((accent.h % 360) + 360) % 360);
  const accentSat = Math.round(Math.min(SAT_MAX, Math.max(SAT_MIN, accent.s)));
  return [
    ":root {",
    renderVars(LIGHT_VARS, h, accentSat),
    "}",
    "@media (prefers-color-scheme: dark) {",
    "  :root {",
    renderVars(DARK_VARS, h, accentSat)
      .split("\n")
      .map((line) => `  ${line}`)
      .join("\n"),
    "  }",
    "}",
  ].join("\n");
}
