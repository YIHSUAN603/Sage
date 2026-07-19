import { test } from "node:test";
import assert from "node:assert/strict";
import i18n, { i18nReady } from "../src/i18n/index.ts";
import { buildContextMessage } from "../src/observe/context.ts";
import type { ContextSnapshot } from "../src/store/observation.ts";

// Assertions below match the zh-TW wording — pin the locale regardless of the
// machine the tests run on.
await i18nReady;
await i18n.changeLanguage("zh-TW");

const MIN = 60_000;

function snaps(entries: [string | null, string, number][]): ContextSnapshot[] {
  return entries.map(([app, title, m]) => ({
    window: app === null ? null : { app_name: app, title },
    at: m * MIN,
  }));
}

test("empty or all-null history yields no message", () => {
  assert.equal(buildContextMessage([], 0), null);
  assert.equal(
    buildContextMessage(snaps([[null, "", 0], [null, "", 1]]), 2 * MIN),
    null,
  );
});

test("a single run reports the current window with dwell up to now", () => {
  const recent = snaps([
    ["Code", "main.rs — Sage", 0],
    ["Code", "main.rs — Sage", 6],
  ]);
  const message = buildContextMessage(recent, 12 * MIN);
  assert.ok(message);
  assert.equal(message.role, "system");
  const text = message.content as string;
  assert.match(text, /目前：Code — main\.rs — Sage/);
  assert.match(text, /約 12 分鐘/); // measured from run start to `now`
});

test("multiple runs come newest first, earlier ones with their own dwell", () => {
  const recent = snaps([
    ["Chrome", "OpenRouter docs", 0],
    ["Chrome", "OpenRouter docs", 8],
    ["Code", "gate.ts", 9],
    ["Code", "gate.ts", 10],
  ]);
  const message = buildContextMessage(recent, 11 * MIN);
  assert.ok(message);
  const lines = (message.content as string).split("\n").filter((l) => l.startsWith("-"));
  assert.equal(lines.length, 2);
  assert.match(lines[0], /目前：Code — gate\.ts（約 2 分鐘）/);
  assert.match(lines[1], /稍早：Chrome — OpenRouter docs（約 8 分鐘）/);
});

test("null gaps are skipped and very short dwells stay readable", () => {
  const recent = snaps([
    ["Chrome", "docs", 0],
    [null, "", 1],
    ["Chrome", "docs", 2],
    ["Code", "a.ts", 3],
  ]);
  const message = buildContextMessage(recent, 3 * MIN + 10_000);
  assert.ok(message);
  const text = message.content as string;
  assert.match(text, /目前：Code — a\.ts（不到 1 分鐘）/);
  // The two Chrome snapshots around the null still merge into one run.
  assert.equal(text.match(/Chrome — docs/g)?.length, 1);
});
