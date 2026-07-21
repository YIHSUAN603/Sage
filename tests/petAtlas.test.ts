import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GESTURE_ROW,
  gestureFlipsX,
  ROWS,
  rowForGesture,
  rowForMood,
} from "../src/windows/petAtlas.ts";

test("rowForMood maps the three moods to their rows", () => {
  assert.equal(rowForMood("idle"), 0);
  assert.equal(rowForMood("thinking"), 6);
  assert.equal(rowForMood("talking"), 3);
});

test("gestures map to the run/jump rows", () => {
  assert.equal(GESTURE_ROW["run-right"], 1);
  // run-left reuses the running-right row (sheets don't reliably face left)…
  assert.equal(GESTURE_ROW["run-left"], 1);
  assert.equal(GESTURE_ROW.jump, 4);
  assert.equal(rowForGesture("run-left"), 1);
  assert.equal(rowForGesture("run-right"), 1);
  assert.equal(rowForGesture("jump"), 4);
});

test("only run-left mirrors the sprite horizontally", () => {
  // …and gets mirrored via CSS instead.
  assert.equal(gestureFlipsX("run-left"), true);
  assert.equal(gestureFlipsX("run-right"), false);
  assert.equal(gestureFlipsX("jump"), false);
});

test("every gesture row exists in the sheet", () => {
  for (const row of Object.values(GESTURE_ROW)) {
    assert.ok(row >= 0 && row < ROWS.length);
  }
});

test("rowForGesture clamps an out-of-range mapping to 0", () => {
  // @ts-expect-error — exercising the clamp with a bad key
  assert.equal(rowForGesture("nope"), 0);
});
