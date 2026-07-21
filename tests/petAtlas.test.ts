import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GESTURE_ROW,
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
  assert.equal(GESTURE_ROW["run-left"], 2);
  assert.equal(GESTURE_ROW.jump, 4);
  assert.equal(rowForGesture("run-left"), 2);
  assert.equal(rowForGesture("run-right"), 1);
  assert.equal(rowForGesture("jump"), 4);
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
