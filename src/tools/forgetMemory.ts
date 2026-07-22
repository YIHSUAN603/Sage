// forget_memory tool: deletes one saved memory by exact name. The deletable
// memories are enumerated in the `name` enum, built from the same index the
// other memory tools share. Like readFile.ts, every failure becomes an error
// string, never a throw.
import type { SageIpc, MemoryMeta } from "../ipc/contract.ts";
import type { ToolSpec } from "./types.ts";

export function createForgetMemoryTool(
  ipc: SageIpc,
  memories: MemoryMeta[],
): ToolSpec {
  return {
    name: "forget_memory",
    description:
      "Delete a saved memory by its exact name — use when a remembered fact " +
      "is no longer true or the user asks you to forget it.",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Exact name of the memory to delete.",
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
        await ipc.forgetMemory(name);
        return `Forgot memory "${name}".`;
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}
