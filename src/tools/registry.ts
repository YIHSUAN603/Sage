// S3.1 — Tool registry: register/look up ToolSpecs and project them into the
// OpenRouter `tools` array shape (contract ToolDef[]).
import type { ToolDef } from "../ipc/contract.ts";
import type { ToolSpec } from "./types.ts";

export interface ToolRegistry {
  register(spec: ToolSpec): void;
  get(name: string): ToolSpec | undefined;
  list(): ToolSpec[];
  /** Contract `ToolDef[]` for ChatRequest.tools, in registration order. */
  toToolDefs(): ToolDef[];
}

export function createToolRegistry(specs: ToolSpec[] = []): ToolRegistry {
  const byName = new Map<string, ToolSpec>();

  const registry: ToolRegistry = {
    register(spec) {
      if (byName.has(spec.name)) {
        throw new Error(`tool already registered: ${spec.name}`);
      }
      byName.set(spec.name, spec);
    },
    get(name) {
      return byName.get(name);
    },
    list() {
      return [...byName.values()];
    },
    toToolDefs() {
      return [...byName.values()].map((spec) => ({
        type: "function" as const,
        function: {
          name: spec.name,
          description: spec.description,
          parameters: spec.parameters,
        },
      }));
    },
  };

  for (const spec of specs) registry.register(spec);
  return registry;
}
