import { test } from "node:test";
import assert from "node:assert/strict";
import { createToolRegistry } from "../src/tools/registry.ts";
import { createReadFileTool } from "../src/tools/readFile.ts";
import { createMockIpc } from "../src/ipc/mock.ts";
import type { ToolSpec } from "../src/tools/types.ts";

function dummyTool(name: string): ToolSpec {
  return {
    name,
    description: `dummy ${name}`,
    parameters: { type: "object", properties: {} },
    execute: async () => name,
  };
}

test("registry registers, looks up, and lists tools in order", () => {
  const registry = createToolRegistry([dummyTool("alpha")]);
  registry.register(dummyTool("beta"));
  assert.equal(registry.get("alpha")?.name, "alpha");
  assert.equal(registry.get("missing"), undefined);
  assert.deepEqual(registry.list().map((t) => t.name), ["alpha", "beta"]);
});

test("registry rejects duplicate tool names", () => {
  const registry = createToolRegistry([dummyTool("alpha")]);
  assert.throws(() => registry.register(dummyTool("alpha")), /already registered/);
});

test("toToolDefs produces the contract ToolDef shape", () => {
  const ipc = createMockIpc();
  const registry = createToolRegistry([createReadFileTool(ipc)]);
  const defs = registry.toToolDefs();
  assert.equal(defs.length, 1);
  assert.equal(defs[0].type, "function");
  assert.equal(defs[0].function.name, "read_file");
  assert.ok(defs[0].function.description.length > 0);
  assert.equal((defs[0].function.parameters as { type: string }).type, "object");
});

test("read_file returns file content via ipc.toolReadFile", async () => {
  const ipc = createMockIpc({ files: { "/tmp/a.txt": "hello" } });
  const tool = createReadFileTool(ipc);
  assert.equal(await tool.execute({ path: "/tmp/a.txt" }), "hello");
  assert.deepEqual(ipc.calls, [{ command: "tool_read_file", args: "/tmp/a.txt" }]);
});

test("read_file turns ipc rejections into error strings, not throws", async () => {
  const ipc = createMockIpc();
  const tool = createReadFileTool(ipc);
  const result = await tool.execute({ path: "/nope.txt" });
  assert.match(result, /^Error: file not found: \/nope\.txt/);
});

test("read_file rejects malformed arguments with an error string", async () => {
  const ipc = createMockIpc({ files: { "/a": "x" } });
  const tool = createReadFileTool(ipc);
  for (const bad of [null, {}, { path: 42 }, { path: "" }, "path"]) {
    assert.match(await tool.execute(bad), /^Error: invalid arguments/);
  }
  // Nothing malformed ever reached the backend.
  assert.deepEqual(ipc.calls, []);
});
