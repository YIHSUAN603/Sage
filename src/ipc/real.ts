// SageIpc implementation backed by the Tauri backend. Commands not yet
// registered in lib.rs reject at runtime — tracks develop against mock.ts
// until their backend counterpart lands.
import { Channel, invoke } from "@tauri-apps/api/core";
import {
  COMMANDS,
  type ActiveWindow,
  type ActivityState,
  type AgentActivity,
  type AgentStreamEvent,
  type ArchiveMeta,
  type ChatMessage,
  type MemoryMeta,
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

  checkAgentCli(cli, path, useWsl, distro): Promise<string> {
    return invoke(COMMANDS.checkAgentCli, { cli, path, useWsl, distro });
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

  listMemories(): Promise<MemoryMeta[]> {
    return invoke(COMMANDS.listMemories);
  },

  readMemory(name: string): Promise<string> {
    return invoke(COMMANDS.readMemory, { name });
  },

  saveMemory(name: string, description: string, body: string): Promise<void> {
    return invoke(COMMANDS.saveMemory, { name, description, body });
  },

  forgetMemory(name: string): Promise<void> {
    return invoke(COMMANDS.forgetMemory, { name });
  },

  loadSession(): Promise<ChatMessage[]> {
    return invoke(COMMANDS.loadSession);
  },

  saveSession(messages: ChatMessage[]): Promise<void> {
    return invoke(COMMANDS.saveSession, { messages });
  },

  archiveSession(): Promise<ArchiveMeta | null> {
    return invoke(COMMANDS.archiveSession);
  },

  listArchives(): Promise<ArchiveMeta[]> {
    return invoke(COMMANDS.listArchives);
  },

  readArchive(id: string): Promise<ChatMessage[]> {
    return invoke(COMMANDS.readArchive, { id });
  },

  deleteArchive(id: string): Promise<void> {
    return invoke(COMMANDS.deleteArchive, { id });
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

  agentActivity(): Promise<AgentActivity | null> {
    return invoke(COMMANDS.agentActivity);
  },
};
