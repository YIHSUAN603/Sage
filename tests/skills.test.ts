import { test } from "node:test";
import assert from "node:assert/strict";
import { runAgentLoop } from "../src/llm/loop.ts";
import { createToolRegistry } from "../src/tools/registry.ts";
import { createSkillTool } from "../src/tools/useSkill.ts";
import { createMockIpc } from "../src/ipc/mock.ts";
import type { MockSkill } from "../src/ipc/mock.ts";
import type { StreamEvent } from "../src/ipc/contract.ts";

const SKILLS: MockSkill[] = [
  {
    name: "pirate-talk",
    description: "Answer like a pirate",
    body: "Always end sentences with arr.",
  },
  {
    name: "haiku-mode",
    description: "Reply in haiku",
    body: "Three lines, 5-7-5 syllables.",
  },
];

test("mock listSkills returns metadata only, readSkill returns the body", async () => {
  const ipc = createMockIpc({ skills: SKILLS });
  assert.deepEqual(await ipc.listSkills(), [
    { name: "pirate-talk", description: "Answer like a pirate" },
    { name: "haiku-mode", description: "Reply in haiku" },
  ]);
  assert.equal(await ipc.readSkill("haiku-mode"), "Three lines, 5-7-5 syllables.");
  await assert.rejects(() => ipc.readSkill("nope"), /skill not found: nope/);
  assert.deepEqual(
    ipc.calls.map((c) => c.command),
    ["list_skills", "read_skill", "read_skill"],
  );
});

test("use_skill description embeds the catalog and parameters enum the names", () => {
  const ipc = createMockIpc({ skills: SKILLS });
  const tool = createSkillTool(ipc, SKILLS);
  assert.equal(tool.name, "use_skill");
  assert.match(tool.description, /- pirate-talk: Answer like a pirate/);
  assert.match(tool.description, /- haiku-mode: Reply in haiku/);
  const nameSchema = (tool.parameters as { properties: { name: { enum: string[] } } })
    .properties.name;
  assert.deepEqual(nameSchema.enum, ["pirate-talk", "haiku-mode"]);
});

test("use_skill returns the skill body with a follow-me preamble", async () => {
  const ipc = createMockIpc({ skills: SKILLS });
  const tool = createSkillTool(ipc, SKILLS);
  const result = await tool.execute({ name: "pirate-talk" });
  assert.match(result, /^Skill "pirate-talk" instructions/);
  assert.match(result, /Always end sentences with arr\./);
  assert.deepEqual(ipc.calls, [{ command: "read_skill", args: "pirate-talk" }]);
});

test("use_skill turns unknown names and bad args into error strings, not throws", async () => {
  const ipc = createMockIpc({ skills: SKILLS });
  const tool = createSkillTool(ipc, SKILLS);
  assert.match(await tool.execute({ name: "nope" }), /^Error: skill not found: nope/);
  for (const bad of [null, {}, { name: 42 }, { name: "" }, "name"]) {
    assert.match(await tool.execute(bad), /^Error: invalid arguments/);
  }
});

test("agent loop runs a full use_skill round trip", async () => {
  const script: StreamEvent[][] = [
    [
      { type: "delta", content: "Loading the pirate skill." },
      {
        type: "delta",
        tool_calls: [
          { index: 0, id: "call_s1", function: { name: "use_skill", arguments: "" } },
        ],
      },
      { type: "delta", tool_calls: [{ index: 0, function: { arguments: '{"name":"pir' } }] },
      { type: "delta", tool_calls: [{ index: 0, function: { arguments: 'ate-talk"}' } }] },
      { type: "done", finish_reason: "tool_calls" },
    ],
    [
      { type: "delta", content: "Ahoy, arr." },
      { type: "done", finish_reason: "stop" },
    ],
  ];
  const ipc = createMockIpc({ script, skills: SKILLS });
  const messages = await runAgentLoop({
    ipc,
    model: "test/free-model",
    messages: [{ role: "user", content: "Talk to me." }],
    tools: createToolRegistry([createSkillTool(ipc, SKILLS)]),
  });

  assert.equal(messages.length, 4);
  const toolMsg = messages[2];
  assert.equal(toolMsg.role, "tool");
  assert.equal(toolMsg.tool_call_id, "call_s1");
  assert.match(toolMsg.content as string, /Always end sentences with arr\./);
  assert.equal(messages[3].content, "Ahoy, arr.");

  // The second round's request advertised use_skill with the catalog.
  const tools = ipc.chatRequests[1].tools;
  assert.equal(tools?.length, 1);
  assert.match(tools[0].function.description, /pirate-talk/);
});
