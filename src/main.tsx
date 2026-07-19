import React from "react";
import ReactDOM from "react-dom/client";
import "./i18n/index.ts"; // must init before any component renders t()
import App from "./App.tsx";
import { resolveIpc } from "./runtime.ts";
import { bindIpc } from "./store/ipc.ts";
import { useSettingsStore } from "./store/settings.ts";

void resolveIpc().then((ipc) => {
  // Single binding point: stores reach the ipc via store/ipc.ts, components
  // via <IpcProvider>. Nothing else imports real.ts/mock.ts.
  bindIpc(ipc);
  void useSettingsStore.getState().load();

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App ipc={ipc} />
    </React.StrictMode>,
  );
});
