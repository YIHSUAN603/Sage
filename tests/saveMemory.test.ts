import { test } from "node:test";
import assert from "node:assert/strict";
import { createSaveMemoryTool } from "../src/tools/saveMemory.ts";
import { createMockIpc } from "../src/ipc/mock.ts";

test("save_memory calls ipc.saveMemory with name/description/body and confirms", async () => {
  const ipc = createMockIpc();
  const tool = createSaveMemoryTool(ipc);
  assert.equal(tool.name, "save_memory");
  const result = await tool.execute({
    name: "coffee-order",
    description: "How the user takes their coffee",
    body: "Oat-milk flat white, one sugar.",
  });
  assert.equal(result, 'Saved memory "coffee-order".');
  assert.deepEqual(ipc.calls, [
    {
      command: "save_memory",
      args: {
        name: "coffee-order",
        description: "How the user takes their coffee",
        body: "Oat-milk flat white, one sugar.",
      },
    },
  ]);
});

test("save_memory rejects incomplete arguments with an error string", async () => {
  const ipc = createMockIpc();
  const tool = createSaveMemoryTool(ipc);
  for (const bad of [
    null,
    {},
    { name: "x", description: "y" },
    { name: "x", description: "y", body: "" },
    { name: "", description: "y", body: "z" },
    { name: "x", description: 42, body: "z" },
    "name",
  ]) {
    assert.match(await tool.execute(bad), /^Error: invalid arguments/);
  }
  // Nothing malformed ever reached the backend.
  assert.deepEqual(ipc.calls, []);
});

test("save_memory turns backend rejections into error strings, not throws", async () => {
  const ipc = createMockIpc();
  const tool = createSaveMemoryTool(ipc);
  // A name with no slug-able characters is rejected by the mock (mirrors memory.rs).
  const result = await tool.execute({ name: "!!!", description: "d", body: "b" });
  assert.match(result, /^Error: invalid memory name: !!!/);
});
