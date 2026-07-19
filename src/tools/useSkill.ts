// use_skill tool: the installed-skill catalog lives in the tool description;
// calling it loads one skill's full SKILL.md body for the model to follow.
// Like readFile.ts, every failure becomes an error string, never a throw.
import type { SageIpc, SkillMeta } from "../ipc/contract.ts";
import type { ToolSpec } from "./types.ts";

export function createSkillTool(ipc: SageIpc, skills: SkillMeta[]): ToolSpec {
  const catalog = skills
    .map((s) => `- ${s.name}: ${s.description}`)
    .join("\n");
  return {
    name: "use_skill",
    description:
      "Load the full instructions of an installed skill. Whenever the current " +
      "task matches a skill's description, call this FIRST and follow the " +
      "returned instructions. Instructions may reference extra files by " +
      "absolute path — read those with read_file.\n" +
      `Available skills:\n${catalog}`,
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Name of the skill to load.",
          enum: skills.map((s) => s.name),
        },
      },
      required: ["name"],
      additionalProperties: false,
    },
    async execute(args) {
      const name = (args as { name?: unknown } | null)?.name;
      if (typeof name !== "string" || name.length === 0) {
        return 'Error: invalid arguments — expected {"name": "<skill name>"}';
      }
      try {
        const body = await ipc.readSkill(name);
        return `Skill "${name}" instructions — follow them for the current task:\n\n${body}`;
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}
