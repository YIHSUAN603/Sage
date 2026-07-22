import { test } from "node:test";
import assert from "node:assert/strict";
import { IDLE_SKIP_SECONDS, shouldSkipWhenIdle } from "../src/observe/idle.ts";

test("active user (0s / undetectable) never skips", () => {
  assert.equal(shouldSkipWhenIdle(0), false);
  assert.equal(shouldSkipWhenIdle(59), false);
});

test("just under the threshold still asks", () => {
  assert.equal(shouldSkipWhenIdle(IDLE_SKIP_SECONDS - 1), false);
});

test("at and beyond the threshold skips", () => {
  assert.equal(shouldSkipWhenIdle(IDLE_SKIP_SECONDS), true);
  assert.equal(shouldSkipWhenIdle(IDLE_SKIP_SECONDS + 1), true);
  assert.equal(shouldSkipWhenIdle(3_600), true);
});

test("a custom threshold overrides the default", () => {
  assert.equal(shouldSkipWhenIdle(30, 60), false);
  assert.equal(shouldSkipWhenIdle(60, 60), true);
  // A larger custom threshold keeps the default-idle user considered active.
  assert.equal(shouldSkipWhenIdle(IDLE_SKIP_SECONDS, 1_200), false);
});
