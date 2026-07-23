import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseMoveTag,
  resolveMoveTarget,
  stepToward,
  type Rect,
} from "../src/windows/wander.ts";

// A 1512×982 primary screen at the origin (logical px, MacBook-ish).
const primary: Rect = { x: 0, y: 0, width: 1512, height: 982 };
// A 1920×1080 external screen to the LEFT of the primary → negative x space.
const left: Rect = { x: -1920, y: 0, width: 1920, height: 1080 };

const win: Rect = { x: 600, y: 500, width: 208, height: 228 };

// A deterministic rng that walks a fixed script, repeating the last value.
function seq(...values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

// --- parseMoveTag ---------------------------------------------------------

test("parses a trailing MOVE tag and strips it from the text", () => {
  const { text, intent } = parseMoveTag("Nice work on that draft!\nMOVE: right");
  assert.equal(text, "Nice work on that draft!");
  assert.equal(intent, "right");
});

test("no MOVE tag → text untouched, intent defaults to stay", () => {
  const { text, intent } = parseMoveTag("Just keeping you company.");
  assert.equal(text, "Just keeping you company.");
  assert.equal(intent, "stay");
});

test("MOVE is case-insensitive and tolerates spacing", () => {
  assert.equal(parseMoveTag("hi\n  move :  Corner ").intent, "corner");
});

test("SILENT text with a MOVE tag still yields the intent", () => {
  // The model declined to speak but chose to move — gate suppresses the bubble
  // on the SILENT text, wander still acts on the intent.
  const { text, intent } = parseMoveTag("SILENT\nMOVE: wander");
  assert.equal(text, "SILENT");
  assert.equal(intent, "wander");
});

test("unknown / garbled MOVE value falls back to stay", () => {
  assert.equal(parseMoveTag("hey\nMOVE: teleport").intent, "stay");
  assert.equal(parseMoveTag("hey\nMOVE: 42").intent, "stay");
});

test("last valid MOVE tag wins when several appear", () => {
  assert.equal(parseMoveTag("a\nMOVE: left\nb\nMOVE: right").intent, "right");
  assert.equal(parseMoveTag("a\nMOVE: left\nb\nMOVE: right").text, "a\nb");
});

// --- resolveMoveTarget ----------------------------------------------------

test("stay → no target", () => {
  assert.equal(resolveMoveTarget("stay", win, primary), null);
});

test("right nudges within the monitor and never overflows", () => {
  const t = resolveMoveTarget("right", win, primary, seq(0));
  assert.ok(t);
  assert.ok(t!.x > win.x);
  assert.ok(t!.x + win.width <= primary.x + primary.width);
  assert.equal(t!.y, win.y); // horizontal-only nudge
});

test("left nudge clamps to the monitor's left edge near the border", () => {
  const nearLeft: Rect = { ...win, x: primary.x + 20 };
  const t = resolveMoveTarget("left", nearLeft, primary, seq(1));
  assert.ok(t);
  assert.equal(t!.x, primary.x); // pinned to the edge
});

test("center places the window at the monitor center", () => {
  const t = resolveMoveTarget("center", win, primary);
  assert.deepEqual(t, {
    x: Math.round((primary.width - win.width) / 2),
    y: Math.round((primary.height - win.height) / 2),
  });
});

test("corner honors the rng-picked quadrant, inset from the edge", () => {
  // rng < 0.5 twice → top-left corner.
  const tl = resolveMoveTarget("corner", win, primary, seq(0.1, 0.1));
  assert.deepEqual(tl, { x: 24, y: 24 });
  // rng >= 0.5 twice → bottom-right corner.
  const br = resolveMoveTarget("corner", win, primary, seq(0.9, 0.9));
  assert.deepEqual(br, {
    x: primary.width - win.width - 24,
    y: primary.height - win.height - 24,
  });
});

test("wander stays fully inside a monitor at negative coordinates", () => {
  const t = resolveMoveTarget("wander", win, left, seq(0.5, 0.5));
  assert.ok(t);
  assert.ok(t!.x >= left.x);
  assert.ok(t!.x + win.width <= left.x + left.width);
  assert.ok(t!.y >= left.y);
  assert.ok(t!.y + win.height <= left.y + left.height);
});

test("no monitor: left/right move relative, bounded intents no-op", () => {
  const rel = resolveMoveTarget("right", win, null, seq(0));
  assert.ok(rel);
  assert.ok(rel!.x > win.x);
  assert.equal(resolveMoveTarget("corner", win, null), null);
  assert.equal(resolveMoveTarget("center", win, null), null);
  assert.equal(resolveMoveTarget("wander", win, null), null);
});

// --- stepToward -----------------------------------------------------------

test("stepToward moves at most maxStep and reports direction", () => {
  const s = stepToward({ x: 0, y: 0 }, { x: 300, y: 0 }, 100);
  assert.equal(s.arrived, false);
  assert.equal(s.dir, 1);
  assert.equal(s.x, 100);
  assert.equal(s.y, 0);
});

test("stepToward snaps to the target and marks arrived when in reach", () => {
  const s = stepToward({ x: 0, y: 0 }, { x: 40, y: 30 }, 100);
  assert.deepEqual({ x: s.x, y: s.y }, { x: 40, y: 30 });
  assert.equal(s.arrived, true);
  assert.equal(s.dir, 1);
});

test("stepToward reports leftward direction", () => {
  assert.equal(stepToward({ x: 500, y: 0 }, { x: 0, y: 0 }, 50).dir, -1);
});
