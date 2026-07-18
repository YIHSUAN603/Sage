// Routes the single React bundle to the right companion window based on the
// `?window=` query set in tauri.conf.json (avatar is the default).
import { IpcProvider } from "./components/IpcContext.tsx";
import type { SageIpc } from "./ipc/contract.ts";
import { AvatarWindow } from "./windows/AvatarWindow.tsx";
import { ChatWindow } from "./windows/ChatWindow.tsx";
import "./App.css";

export type SageWindowKind = "avatar" | "chat";

export function windowKindFromSearch(search: string): SageWindowKind {
  return new URLSearchParams(search).get("window") === "chat"
    ? "chat"
    : "avatar";
}

interface Props {
  ipc: SageIpc;
}

function App({ ipc }: Props) {
  const kind = windowKindFromSearch(window.location.search);
  return (
    <IpcProvider value={ipc}>
      {kind === "chat" ? <ChatWindow /> : <AvatarWindow />}
    </IpcProvider>
  );
}

export default App;
