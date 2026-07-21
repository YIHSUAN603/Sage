import { test } from "node:test";
import assert from "node:assert/strict";
import { pruneHourWindow, underHourlyQuota } from "../src/observe/quota.ts";

const HOUR = 60 * 60 * 1000;
const NOW = 10 * HOUR;

test("maxPerHour 0 (or negative) means unlimited", () => {
  const many = Array.from({ length: 50 }, (_, i) => NOW - i * 1000);
  assert.ok(underHourlyQuota(many, NOW, 0));
  assert.ok(underHourlyQuota(many, NOW, -1));
});

test("quota blocks once the rolling hour is full", () => {
  assert.ok(underHourlyQuota([], NOW, 2));
  assert.ok(underHourlyQuota([NOW - 1000], NOW, 2));
  assert.ok(!underHourlyQuota([NOW - 1000, NOW - 2000], NOW, 2));
});

test("bubbles older than an hour fall out of the window", () => {
  const stale = [NOW - HOUR - 1, NOW - 2 * HOUR];
  const fresh = NOW - HOUR + 1000;
  assert.deepEqual(pruneHourWindow([...stale, fresh], NOW), [fresh]);
  // Two stale + one fresh under a cap of 2 → still allowed.
  assert.ok(underHourlyQuota([...stale, fresh], NOW, 2));
});
