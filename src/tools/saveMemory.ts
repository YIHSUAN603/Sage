// save_memory tool: persists one durable fact to <config>/memory/ so it
// survives across conversations. Reusing an existing name overwrites that
// memory (used for edits). Like readFile.ts, every failure becomes an error
// string, never a throw.
import type { SageIpc } from "../ipc/contract.ts";
import type { ToolSpec } from "./types.ts";

export function createSaveMemoryTool(ipc: SageIpc): ToolSpec {
  return {
    name: "save_memory",
    description:
      "Persist a durable fact worth remembering across conversations (a " +
      "stable preference, a name, an ongoing project — not a passing detail). " +
      "Store one fact per memory. To update something you already remember, " +
      "reuse its existing name and the memory is overwritten.",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description:
            "Short kebab-case identifier for the memory (e.g. \"coffee-order\").",
        },
        description: {
          type: "string",
          description: "One-line summary shown in the memory index.",
        },
        body: {
          type: "string",
          description: "The fact to remember, in full.",
        },
      },
      required: ["name", "description", "body"],
      additionalProperties: false,
    },
    async execute(args) {
      const a = args as
        | { name?: unknown; description?: unknown; body?: unknown }
        | null;
      const name = a?.name;
      const description = a?.description;
      const body = a?.body;
      if (
        typeof name !== "string" ||
        name.length === 0 ||
        typeof description !== "string" ||
        description.length === 0 ||
        typeof body !== "string" ||
        body.length === 0
      ) {
        return 'Error: invalid arguments — expected {"name": "<name>", "description": "<summary>", "body": "<fact>"}';
      }
      try {
        await ipc.saveMemory(name, description, body);
        return `Saved memory "${name}".`;
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}
