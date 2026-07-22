import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMemoryIndexMessage } from "../src/memory/context.ts";
import type { MemoryMeta } from "../src/ipc/contract.ts";

const MEMORIES: MemoryMeta[] = [
  { name: "coffee-order", description: "How the user takes their coffee" },
  { name: "kids-names", description: "The user's children" },
];

test("buildMemoryIndexMessage returns null when nothing is remembered", () => {
  assert.equal(buildMemoryIndexMessage([]), null);
});

test("buildMemoryIndexMessage lists every name + description as a system message", () => {
  const msg = buildMemoryIndexMessage(MEMORIES);
  assert.ok(msg);
  assert.equal(msg.role, "system");
  const content = msg.content as string;
  assert.match(content, /- coffee-order: How the user takes their coffee/);
  assert.match(content, /- kids-names: The user's children/);
});

test("buildMemoryIndexMessage never leaks a memory body — index only", () => {
  // Bodies are not part of MemoryMeta, so there is no way for them to appear;
  // assert the message carries only the index lines beyond the intro.
  const msg = buildMemoryIndexMessage(MEMORIES);
  assert.ok(msg);
  const content = msg.content as string;
  assert.doesNotMatch(content, /Oat-milk|flat white|Mei|Kai/);
  // Exactly one line per memory in the index body (intro line + 2 memory lines).
  const memoryLines = content.split("\n").filter((l) => l.startsWith("- "));
  assert.equal(memoryLines.length, 2);
});
