// recall_memory tool: the saved-memory index lives in the tool description;
// calling it loads one memory's full body for the model to use. Same
// catalog-plus-lazy-load pattern as use_skill.ts (only the index rides in each
// request; bodies load on demand). Like readFile.ts, every failure becomes an
// error string, never a throw.
import type { SageIpc, MemoryMeta } from "../ipc/contract.ts";
import type { ToolSpec } from "./types.ts";

export function createRecallMemoryTool(
  ipc: SageIpc,
  memories: MemoryMeta[],
): ToolSpec {
  const catalog = memories
    .map((m) => `- ${m.name}: ${m.description}`)
    .join("\n");
  return {
    name: "recall_memory",
    description:
      "Load the full content of a saved memory. The index below lists what " +
      "you remember by name and one-line summary; call this to read a " +
      "memory's full body when it's relevant to the conversation.\n" +
      `Available memories:\n${catalog}`,
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Name of the memory to load.",
          enum: memories.map((m) => m.name),
        },
      },
      required: ["name"],
      additionalProperties: false,
    },
    async execute(args) {
      const name = (args as { name?: unknown } | null)?.name;
      if (typeof name !== "string" || name.length === 0) {
        return 'Error: invalid arguments — expected {"name": "<memory name>"}';
      }
      try {
        const body = await ipc.readMemory(name);
        return `Memory "${name}":\n\n${body}`;
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}
