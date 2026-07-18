// Module-level SageIpc handle for the zustand stores. Bound exactly once at
// app bootstrap (src/main.tsx) — stores never import real.ts/mock.ts
// themselves, so tests can bind a MockIpc here and drive store actions.
import type { SageIpc } from "../ipc/contract.ts";

let bound: SageIpc | null = null;

export function bindIpc(ipc: SageIpc): void {
  bound = ipc;
}

export function requireIpc(): SageIpc {
  if (!bound) {
    throw new Error("SageIpc not bound — call bindIpc() at bootstrap first");
  }
  return bound;
}
