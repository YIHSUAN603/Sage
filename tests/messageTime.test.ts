// Track UI — pure timeline annotation for MessageList (grouping, date
// separators, formatting). No DOM involved.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ChatMessage } from "../src/ipc/contract.ts";
import {
  annotateTimeline,
  formatDate,
  formatTime,
} from "../src/components/messageTime.ts";

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
// A fixed local-noon anchor keeps day math away from midnight edges.
const NOW = new Date(2026, 6, 23, 12, 0, 0).getTime();

function msg(role: ChatMessage["role"], ts?: number): ChatMessage {
  return { role, content: "x", ...(ts === undefined ? {} : { ts }) };
}

test("same-role messages within 5 minutes group; only the last shows time", () => {
  const out = annotateTimeline(
    [msg("user", NOW), msg("user", NOW + 2 * MIN), msg("assistant", NOW + 3 * MIN)],
    NOW + 3 * MIN,
  );
  assert.deepEqual(
    out.map((a) => a.showTime),
    [false, true, true],
  );
  assert.deepEqual(
    out.map((a) => a.groupEnd),
    [false, true, true],
  );
});

test("a 5-minute-or-larger gap breaks the group even for the same role", () => {
  const out = annotateTimeline([msg("user", NOW), msg("user", NOW + 5 * MIN)], NOW);
  assert.equal(out[0].showTime, true);
  assert.equal(out[1].showTime, true);
});

test("role change breaks the group", () => {
  const out = annotateTimeline(
    [msg("assistant", NOW), msg("user", NOW + MIN)],
    NOW,
  );
  assert.equal(out[0].showTime, true);
});

test("messages without ts never show time and never join groups", () => {
  const out = annotateTimeline([msg("user"), msg("user", NOW)], NOW);
  assert.equal(out[0].showTime, false);
  assert.equal(out[0].groupEnd, true);
  assert.equal(out[0].dateSep, null);
  assert.equal(out[1].showTime, true);
  assert.equal(out[1].dateSep, "today");
});

test("tool/system rows are ignored and never break a group", () => {
  const messages: ChatMessage[] = [
    msg("assistant", NOW),
    { role: "tool", content: "result", tool_call_id: "c1" },
    msg("assistant", NOW + MIN),
  ];
  const out = annotateTimeline(messages, NOW);
  assert.equal(out[0].showTime, false);
  assert.equal(out[1].showTime, false);
  assert.equal(out[2].showTime, true);
});

test("date separators classify today / yesterday / older", () => {
  const out = annotateTimeline(
    [msg("user", NOW - 3 * DAY), msg("user", NOW - DAY), msg("user", NOW)],
    NOW,
  );
  assert.equal(out[0].dateSep, NOW - 3 * DAY);
  assert.equal(out[1].dateSep, "yesterday");
  assert.equal(out[2].dateSep, "today");
});

test("no separator repeats within the same day", () => {
  const out = annotateTimeline(
    [msg("user", NOW), msg("assistant", NOW + 10 * MIN)],
    NOW + 10 * MIN,
  );
  assert.equal(out[0].dateSep, "today");
  assert.equal(out[1].dateSep, null);
});

test("formatters tolerate every UI locale and bad tags", () => {
  for (const locale of ["zh-TW", "en", "zh-CN", "ja", "not-a-locale!!"]) {
    assert.ok(formatTime(NOW, locale).length > 0);
    assert.ok(formatDate(NOW - 3 * DAY, NOW, locale).length > 0);
    assert.ok(formatDate(NOW - 400 * DAY, NOW, locale).length > 0);
  }
});
