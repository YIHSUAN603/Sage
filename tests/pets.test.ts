import { test } from "node:test";
import assert from "node:assert/strict";
import i18n, { i18nReady } from "../src/i18n/index.ts";
import { createMockIpc } from "../src/ipc/mock.ts";
import { DEFAULT_SETTINGS, type Pet } from "../src/ipc/contract.ts";
import { bindIpc } from "../src/store/ipc.ts";
import { useSettingsStore } from "../src/store/settings.ts";
import {
  chatPersonaSystem,
  gateSystem,
  personaIdentity,
} from "../src/store/persona.ts";
import { MOOD_ROW, ROWS, rowForMood } from "../src/windows/petAtlas.ts";

await i18nReady;
await i18n.changeLanguage("zh-TW");

const CUSTOM: Pet = {
  id: "dragon",
  displayName: "小龍",
  description: "一隻剛孵化的小龍",
  spritesheetPath: "spritesheet.webp",
  persona: "你是使用者桌面上的小龍，愛噴火。",
};

// A plain hatch-pet folder: contract keys only, no `sage` block.
const PLAIN: Pet = {
  id: "pip",
  displayName: "皮皮",
  description: "活潑好動的小夥伴",
  spritesheetPath: "spritesheet.webp",
};

function useActivePet(id: string): void {
  useSettingsStore.setState({
    settings: { ...DEFAULT_SETTINGS, active_pet: id },
  });
}

test("mock listPets/readPet/readPetAtlas round-trip", async () => {
  const ipc = createMockIpc({ pets: [CUSTOM, PLAIN] });
  assert.deepEqual(await ipc.listPets(), [
    { id: "dragon", displayName: "小龍", description: "一隻剛孵化的小龍" },
    { id: "pip", displayName: "皮皮", description: "活潑好動的小夥伴" },
  ]);
  assert.equal((await ipc.readPet("dragon")).persona, CUSTOM.persona);
  await assert.rejects(() => ipc.readPet("nope"), /pet not found: nope/);
  assert.match(await ipc.readPetAtlas("pip"), /^data:image\/png;base64,/);
});

test("importPet returns metadata and makes the pet discoverable", async () => {
  const ipc = createMockIpc({
    importResult: { id: "dragon", displayName: "小龍", description: "一隻剛孵化的小龍" },
  });
  const imported = await ipc.importPet();
  assert.deepEqual(imported, {
    id: "dragon",
    displayName: "小龍",
    description: "一隻剛孵化的小龍",
  });
  // Now discoverable by the picker + atlas load, like a real import.
  assert.deepEqual(await ipc.listPets(), [imported]);
  assert.match(await ipc.readPetAtlas("dragon"), /^data:image\/png;base64,/);
});

test("importPet resolves null when the picker is cancelled", async () => {
  const ipc = createMockIpc();
  assert.equal(await ipc.importPet(), null);
  assert.deepEqual(await ipc.listPets(), []);
});

test("no companion selected → chat injects nothing, persona is built-in Sage", async () => {
  bindIpc(createMockIpc({ pets: [CUSTOM, PLAIN] }));
  useActivePet("");
  assert.equal(await chatPersonaSystem(), null);
  const identity = await personaIdentity();
  assert.match(identity, /Sage/);
});

test("custom persona is used verbatim for chat and gate", async () => {
  bindIpc(createMockIpc({ pets: [CUSTOM, PLAIN] }));
  useActivePet("dragon");
  assert.equal(await personaIdentity(), CUSTOM.persona);
  assert.equal(await chatPersonaSystem(), CUSTOM.persona);
  const gate = await gateSystem();
  assert.ok(gate.startsWith(CUSTOM.persona!));
  assert.match(gate, /SILENT/); // the proactive protocol is appended
});

test("plain hatch-pet folder gets a persona synthesized from name + description", async () => {
  bindIpc(createMockIpc({ pets: [CUSTOM, PLAIN] }));
  useActivePet("pip");
  const identity = await personaIdentity();
  assert.match(identity, /皮皮/); // name interpolated
  assert.match(identity, /活潑好動的小夥伴/); // description appended
  assert.equal(await chatPersonaSystem(), identity);
});

test("unknown/unreadable pet falls back to built-in persona", async () => {
  bindIpc(createMockIpc({ pets: [CUSTOM] }));
  useActivePet("ghost");
  assert.match(await personaIdentity(), /Sage/);
});

test("atlas has 9 rows and every mood maps into range", () => {
  assert.equal(ROWS.length, 9);
  // Each row's frame count never exceeds the 8 columns of the atlas.
  for (const row of ROWS) assert.ok(row.durations.length <= 8);
  assert.deepEqual(MOOD_ROW, { idle: 0, thinking: 6, talking: 3 });
  assert.equal(rowForMood("idle"), 0);
  assert.equal(rowForMood("thinking"), 6);
  assert.equal(rowForMood("talking"), 3);
});
