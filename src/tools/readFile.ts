// S3.1 — read_file tool: wraps ipc.toolReadFile. Every failure (bad args or
// backend rejection) becomes an error string returned to the model, never a
// throw, so the loop keeps going and the model can self-correct.
import type { SageIpc } from "../ipc/contract.ts";
import type { ToolSpec } from "./types.ts";

export function createReadFileTool(ipc: SageIpc): ToolSpec {
  return {
    name: "read_file",
    description:
      "Read a local UTF-8 text file (max 256KB) and return its content. " +
      "Use when the user refers to a file by path.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Absolute path of the file to read.",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
    async execute(args) {
      const path = (args as { path?: unknown } | null)?.path;
      if (typeof path !== "string" || path.length === 0) {
        return 'Error: invalid arguments — expected {"path": "<file path>"}';
      }
      try {
        return await ipc.toolReadFile(path);
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}
