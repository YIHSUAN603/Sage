import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deriveThemeCss,
  extractAccent,
  parseAccentHex,
} from "../src/windows/companionTheme.ts";

// ---------------------------------------------------------------------------
// parseAccentHex
// ---------------------------------------------------------------------------

test("parseAccentHex reads #rrggbb and #rgb", () => {
  // #5e7f52 — the sage green accent, hue ≈ 104°.
  const green = parseAccentHex("#5e7f52");
  assert.ok(green);
  assert.ok(Math.abs(green.h - 104) < 2, `hue ${green.h}`);
  assert.ok(green.s > 15 && green.s < 30, `sat ${green.s}`);

  const short = parseAccentHex("#f00");
  assert.ok(short);
  assert.equal(Math.round(short.h), 0);
  assert.equal(Math.round(short.s), 100);

  // Leading # is optional, surrounding spaces tolerated.
  assert.ok(parseAccentHex(" 6f8fa3 "));
});

test("parseAccentHex rejects malformed input", () => {
  assert.equal(parseAccentHex(""), null);
  assert.equal(parseAccentHex("#12345"), null);
  assert.equal(parseAccentHex("#gggggg"), null);
  assert.equal(parseAccentHex("blue"), null);
});

// ---------------------------------------------------------------------------
// extractAccent
// ---------------------------------------------------------------------------

/** Build an RGBA buffer from [r,g,b,a] pixel tuples. */
function pixels(...px: [number, number, number, number][]): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(px.length * 4);
  px.forEach(([r, g, b, a], i) => buf.set([r, g, b, a], i * 4));
  return buf;
}

test("extractAccent finds the dominant hue of a colorful sprite", () => {
  // Mostly blue body with a couple of red details.
  const accent = extractAccent(
    pixels(
      [40, 90, 200, 255],
      [50, 100, 210, 255],
      [45, 95, 205, 255],
      [200, 40, 40, 255],
    ),
  );
  assert.ok(accent);
  assert.ok(accent.h > 200 && accent.h < 240, `hue ${accent.h}`);
});

test("extractAccent ignores transparent and near-gray pixels", () => {
  const accent = extractAccent(
    pixels(
      [255, 0, 0, 10], // transparent red — must not vote
      [128, 128, 128, 255], // gray — no hue
      [20, 20, 20, 255], // near-black outline
      [80, 160, 60, 255], // the only real vote: green
    ),
  );
  assert.ok(accent);
  assert.ok(accent.h > 80 && accent.h < 130, `hue ${accent.h}`);
});

test("extractAccent returns null when nothing colorful exists", () => {
  assert.equal(extractAccent(pixels()), null);
  assert.equal(
    extractAccent(pixels([0, 0, 0, 0], [128, 128, 128, 255], [250, 250, 250, 255])),
    null,
  );
});

// ---------------------------------------------------------------------------
// deriveThemeCss
// ---------------------------------------------------------------------------

test("deriveThemeCss emits light and dark blocks with the accent hue", () => {
  const css = deriveThemeCss({ h: 220, s: 30 });
  assert.match(css, /^:root \{/);
  assert.match(css, /@media \(prefers-color-scheme: dark\)/);
  // Accent vars take the hue and the (unclamped-at-30) saturation.
  assert.match(css, /--leaf: hsl\(220 30% 54%\);/);
  assert.match(css, /--leaf-deep: hsl\(220 30% 41%\);/);
  // Both schemes restate the surfaces.
  assert.equal(css.match(/--bubble-bg:/g)?.length, 2);
  assert.equal(css.match(/--ink:/g)?.length, 2);
  // Fixed colors are never overridden.
  assert.doesNotMatch(css, /--error-/);
});

test("deriveThemeCss clamps garish and washed-out saturations", () => {
  assert.match(deriveThemeCss({ h: 0, s: 100 }), /--leaf: hsl\(0 45% 54%\);/);
  assert.match(deriveThemeCss({ h: 0, s: 2 }), /--leaf: hsl\(0 18% 54%\);/);
});

test("deriveThemeCss normalizes out-of-range hues", () => {
  assert.match(deriveThemeCss({ h: 380, s: 30 }), /--leaf: hsl\(20 30% 54%\);/);
  assert.match(deriveThemeCss({ h: -40, s: 30 }), /--leaf: hsl\(320 30% 54%\);/);
});
