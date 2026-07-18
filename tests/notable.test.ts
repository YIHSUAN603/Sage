import { test } from "node:test";
import assert from "node:assert/strict";
import { assessNotable, type WindowSample } from "../src/observe/notable.ts";

const MIN = 60_000;

/** Build samples from [app, title, minuteOffset] triples. */
function seq(entries: [string, string, number][]): WindowSample[] {
  return entries.map(([app_name, title, m]) => ({
    app_name,
    title,
    at: m * MIN,
  }));
}

/** One sample every `stepMin` minutes in the same window. */
function dwell(app: string, title: string, fromMin: number, toMin: number, stepMin = 1) {
  const out: [string, string, number][] = [];
  for (let m = fromMin; m <= toMin; m += stepMin) out.push([app, title, m]);
  return out;
}

test("not notable: fewer than two samples", () => {
  assert.deepEqual(assessNotable([]), { notable: false, reason: "" });
  assert.deepEqual(assessNotable(seq([["Code", "a.ts", 0]])), {
    notable: false,
    reason: "",
  });
});

test("stuck: same window past the threshold triggers with dwell time", () => {
  const result = assessNotable(seq(dwell("Code", "main.rs — Sage", 0, 16)));
  assert.equal(result.notable, true);
  assert.match(result.reason, /16 min/);
  assert.match(result.reason, /Code/);
  assert.match(result.reason, /main\.rs — Sage/);
});

test("stuck: does not trigger below the threshold or after a window change", () => {
  // 14 minutes < 15-minute default.
  assert.equal(assessNotable(seq(dwell("Code", "a.ts", 0, 14))).notable, false);
  // 20 minutes on Code, but the trailing run restarted when Slack interrupted.
  const interrupted = seq([
    ...dwell("Code", "a.ts", 0, 20),
    ["Slack", "#general", 21],
    ...dwell("Code", "a.ts", 22, 30),
  ]);
  assert.equal(assessNotable(interrupted).notable, false);
});

test("stuck: idle gaps inside the run do not count as focus time", () => {
  // Same window before and after a 20-minute sampling gap in the middle;
  // only the 10 minutes after the gap count as continuous focus, so a naive
  // first-to-last measurement (40 min) must NOT fire the 15-minute rule.
  const gapInMiddle = seq([
    ...dwell("Code", "a.ts", 0, 10),
    ...dwell("Code", "a.ts", 30, 40),
  ]);
  assert.equal(assessNotable(gapInMiddle).notable, false);
  // Once the post-gap run alone crosses the threshold, stuck fires again.
  const longAfterGap = seq([
    ...dwell("Code", "a.ts", 0, 10),
    ...dwell("Code", "a.ts", 30, 46),
  ]);
  const result = assessNotable(longAfterGap);
  assert.equal(result.notable, true);
  assert.match(result.reason, /16 min/);
});

test("rapid switching: many switches in the look-back window triggers", () => {
  const hopping = seq([
    ["Code", "a.ts", 0],
    ["Chrome", "docs", 0.3],
    ["Code", "a.ts", 0.6],
    ["Slack", "#help", 0.9],
    ["Chrome", "stack overflow", 1.2],
    ["Code", "a.ts", 1.5],
    ["Chrome", "docs", 1.8],
  ]);
  const result = assessNotable(hopping);
  assert.equal(result.notable, true);
  assert.match(result.reason, /6 window switches/);
});

test("rapid switching: slow or few switches do not trigger", () => {
  // Only 3 switches within the 2-minute window.
  const few = seq([
    ["Code", "a.ts", 0],
    ["Chrome", "docs", 0.5],
    ["Code", "a.ts", 1.0],
    ["Slack", "#help", 1.5],
  ]);
  assert.equal(assessNotable(few).notable, false);
  // 6 switches, but spread over 12 minutes — outside the look-back window.
  const slow = seq([
    ["Code", "a.ts", 0],
    ["Chrome", "docs", 2],
    ["Code", "a.ts", 4],
    ["Slack", "#help", 6],
    ["Chrome", "docs", 8],
    ["Code", "a.ts", 10],
    ["Chrome", "docs", 12],
  ]);
  assert.equal(assessNotable(slow).notable, false);
});

test("idle-return: a long sampling gap before the latest sample triggers", () => {
  const samples = seq([
    ["Code", "a.ts", 0],
    ["Code", "a.ts", 1],
    ["Slack", "#general", 31], // 30-minute gap
  ]);
  const result = assessNotable(samples);
  assert.equal(result.notable, true);
  assert.match(result.reason, /30 min/);
  assert.match(result.reason, /Slack/);
});

test("idle-return: normal sampling cadence does not trigger", () => {
  const samples = seq([
    ["Code", "a.ts", 0],
    ["Code", "a.ts", 1],
    ["Slack", "#general", 4], // 3-minute gap < 5-minute default
  ]);
  assert.equal(assessNotable(samples).notable, false);
});

test("thresholds are injectable", () => {
  const samples = seq(dwell("Code", "a.ts", 0, 3));
  assert.equal(assessNotable(samples).notable, false);
  const tight = assessNotable(samples, { stuckMs: 2 * MIN });
  assert.equal(tight.notable, true);
  assert.match(tight.reason, /3 min/);
});
