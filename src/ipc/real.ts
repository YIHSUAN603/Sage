// SageIpc implementation backed by the Tauri backend. Commands not yet
// registered in lib.rs reject at runtime — tracks develop against mock.ts
// until their backend counterpart lands.
import { Channel, invoke } from "@tauri-apps/api/core";
import {
  COMMANDS,
  type ActiveWindow,
  type SageIpc,
  type Settings,
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

  toolReadFile(path: string): Promise<string> {
    return invoke(COMMANDS.toolReadFile, { path });
  },

  getSettings(): Promise<Settings> {
    return invoke(COMMANDS.getSettings);
  },

  setSettings(settings: Settings): Promise<void> {
    return invoke(COMMANDS.setSettings, { settings });
  },

  captureScreen(): Promise<string> {
    return invoke(COMMANDS.captureScreen);
  },

  activeWindow(): Promise<ActiveWindow | null> {
    return invoke(COMMANDS.activeWindow);
  },
};
