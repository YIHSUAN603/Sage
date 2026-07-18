// Entry-time IPC binding. The real Tauri bridge is picked only when running
// inside Tauri; a plain browser (vite dev without Tauri) falls back to the
// offline mock so the UI stays workable. Components never import real.ts
// directly — they get SageIpc via context (components/IpcContext) and stores
// reach it through store/ipc.ts, both bound once in main.tsx.
import type { SageIpc } from "./ipc/contract.ts";
import { createMockIpc } from "./ipc/mock.ts";

export function hasTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function resolveIpc(): Promise<SageIpc> {
  if (hasTauri()) {
    // Dynamic import keeps @tauri-apps/api out of the pure-browser dev path.
    const { realIpc } = await import("./ipc/real.ts");
    return realIpc;
  }
  return createMockIpc();
}
