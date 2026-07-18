// SageIpc is injected here once at bootstrap (main.tsx) so components never
// import real.ts/mock.ts directly — see src/runtime.ts for the selection.
import { createContext, useContext } from "react";
import type { SageIpc } from "../ipc/contract.ts";

const IpcContext = createContext<SageIpc | null>(null);

export const IpcProvider = IpcContext.Provider;

export function useIpc(): SageIpc {
  const ipc = useContext(IpcContext);
  if (!ipc) throw new Error("useIpc must be used inside <IpcProvider>");
  return ipc;
}
