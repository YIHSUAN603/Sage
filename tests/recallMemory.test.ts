import { test } from "node:test";
import assert from "node:assert/strict";
import { createRecallMemoryTool } from "../src/tools/recallMemory.ts";
import { createMockIpc } from "../src/ipc/mock.ts";
import type { MockMemory } from "../src/ipc/mock.ts";

const MEMORIES: MockMemory[] = [
  {
    name: "coffee-order",
    description: "How the user takes their coffee",
    body: "Oat-milk flat white, one sugar.",
  },
  {
    name: "kids-names",
    description: "The user's children",
    body: "Two kids: Mei and Kai.",
  },
];

test("recall_memory embeds the index catalog and enums the names", () => {
  const ipc = createMockIpc({ memories: MEMORIES });
  const tool = createRecallMemoryTool(ipc, MEMORIES);
  assert.equal(tool.name, "recall_memory");
  assert.match(tool.description, /- coffee-order: How the user takes their coffee/);
  assert.match(tool.description, /- kids-names: The user's children/);
  const nameSchema = (tool.parameters as { properties: { name: { enum: string[] } } })
    .properties.name;
  assert.deepEqual(nameSchema.enum, ["coffee-order", "kids-names"]);
});

test("recall_memory returns the memory body via ipc.readMemory", async () => {
  const ipc = createMockIpc({ memories: MEMORIES });
  const tool = createRecallMemoryTool(ipc, MEMORIES);
  const result = await tool.execute({ name: "coffee-order" });
  assert.match(result, /^Memory "coffee-order":/);
  assert.match(result, /Oat-milk flat white, one sugar\./);
  assert.deepEqual(ipc.calls, [{ command: "read_memory", args: "coffee-order" }]);
});

test("recall_memory turns unknown names and bad args into error strings, not throws", async () => {
  const ipc = createMockIpc({ memories: MEMORIES });
  const tool = createRecallMemoryTool(ipc, MEMORIES);
  assert.match(await tool.execute({ name: "nope" }), /^Error: memory not found: nope/);
  for (const bad of [null, {}, { name: 42 }, { name: "" }, "name"]) {
    assert.match(await tool.execute(bad), /^Error: invalid arguments/);
  }
});
