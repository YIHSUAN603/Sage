// SageIpc implementation backed by the Tauri backend. Commands not yet
// registered in lib.rs reject at runtime — tracks develop against mock.ts
// until their backend counterpart lands.
import { Channel, invoke } from "@tauri-apps/api/core";
import {
  COMMANDS,
  type ActiveWindow,
  type ActivityState,
  type AgentStreamEvent,
  type Pet,
  type PetMeta,
  type SageIpc,
  type SemanticSnapshot,
  type Settings,
  type SkillMeta,
  type StreamEvent,
} from "./contract.ts";

export const realIpc: SageIpc = {
  async chatStream(req, onEvent, signal) {
    const channel = new Channel<StreamEvent>();
    channel.onmessage = (event) => {
      if (!signal?.aborted) onEvent(event);
    };
    await invoke(COMMANDS.chatStream, { channel, req });
  },

  async agentStream(req, onEvent, signal) {
    const channel = new Channel<AgentStreamEvent>();
    channel.onmessage = (event) => {
      if (!signal?.aborted) onEvent(event);
    };
    await invoke(COMMANDS.agentStream, { channel, req });
  },

  checkAgentCli(cli, path): Promise<string> {
    return invoke(COMMANDS.checkAgentCli, { cli, path });
  },

  toolReadFile(path: string): Promise<string> {
    return invoke(COMMANDS.toolReadFile, { path });
  },

  listSkills(): Promise<SkillMeta[]> {
    return invoke(COMMANDS.listSkills);
  },

  readSkill(name: string): Promise<string> {
    return invoke(COMMANDS.readSkill, { name });
  },

  listPets(): Promise<PetMeta[]> {
    return invoke(COMMANDS.listPets);
  },

  readPet(id: string): Promise<Pet> {
    return invoke(COMMANDS.readPet, { id });
  },

  readPetAtlas(id: string): Promise<string> {
    return invoke(COMMANDS.readPetAtlas, { id });
  },

  async importPet(): Promise<PetMeta | null> {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const sourcePath = await open({ directory: true });
    if (typeof sourcePath !== "string") return null; // cancelled
    return invoke(COMMANDS.importPet, { sourcePath });
  },

  updatePetSage(id, persona, proactive): Promise<void> {
    return invoke(COMMANDS.updatePetSage, {
      id,
      persona,
      cooldownMinutes: proactive.cooldownMinutes ?? null,
      maxPerHour: proactive.maxPerHour ?? null,
    });
  },

  getSettings(): Promise<Settings> {
    return invoke(COMMANDS.getSettings);
  },

  setSettings(settings: Settings): Promise<void> {
    return invoke(COMMANDS.setSettings, { settings });
  },

  semanticSnapshot(): Promise<SemanticSnapshot> {
    return invoke(COMMANDS.semanticSnapshot);
  },

  activityState(): Promise<ActivityState> {
    return invoke(COMMANDS.activityState);
  },

  activeWindow(): Promise<ActiveWindow | null> {
    return invoke(COMMANDS.activeWindow);
  },
};
