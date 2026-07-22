import { test } from "node:test";
import assert from "node:assert/strict";
import { createForgetMemoryTool } from "../src/tools/forgetMemory.ts";
import { createMockIpc } from "../src/ipc/mock.ts";
import type { MockMemory } from "../src/ipc/mock.ts";

const MEMORIES: MockMemory[] = [
  {
    name: "coffee-order",
    description: "How the user takes their coffee",
    body: "Oat-milk flat white, one sugar.",
  },
];

test("forget_memory enums the deletable names", () => {
  const ipc = createMockIpc({ memories: MEMORIES });
  const tool = createForgetMemoryTool(ipc, MEMORIES);
  assert.equal(tool.name, "forget_memory");
  const nameSchema = (tool.parameters as { properties: { name: { enum: string[] } } })
    .properties.name;
  assert.deepEqual(nameSchema.enum, ["coffee-order"]);
});

test("forget_memory calls ipc.forgetMemory and confirms", async () => {
  const ipc = createMockIpc({ memories: MEMORIES });
  const tool = createForgetMemoryTool(ipc, MEMORIES);
  const result = await tool.execute({ name: "coffee-order" });
  assert.equal(result, 'Forgot memory "coffee-order".');
  assert.deepEqual(ipc.calls, [{ command: "forget_memory", args: "coffee-order" }]);
});

test("forget_memory turns unknown names and bad args into error strings, not throws", async () => {
  const ipc = createMockIpc({ memories: MEMORIES });
  const tool = createForgetMemoryTool(ipc, MEMORIES);
  assert.match(await tool.execute({ name: "nope" }), /^Error: memory not found: nope/);
  for (const bad of [null, {}, { name: 42 }, { name: "" }, "name"]) {
    assert.match(await tool.execute(bad), /^Error: invalid arguments/);
  }
});
