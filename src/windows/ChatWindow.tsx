// S4.2 — The speech-bubble chat window: frameless rounded card that sits
// next to the avatar. Streams live via the chat store and broadcasts the
// avatar mood over a Tauri event so the avatar webview can animate.
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  nextPermission,
  normalizePermission,
  PERMISSION_ICON,
  PERMISSION_LABEL_KEY,
} from "../components/agentPermission.ts";
import { Composer } from "../components/Composer.tsx";
import { MessageList } from "../components/MessageList.tsx";
import {
  BUBBLE_OPEN_EVENT,
  CONTEXT_EVENT,
  type BubbleOpenEventPayload,
  type ContextEventPayload,
} from "../events.ts";
import { hasTauri } from "../runtime.ts";
import { avatarMood, MOOD_EVENT, useChatStore } from "../store/chat.ts";
import { useCompanionName } from "../store/companion.ts";
import { useWindowSizeMemory } from "./useWindowSizeMemory.ts";
import { useObservationStore } from "../store/observation.ts";
import { hasApiKey, useSettingsStore } from "../store/settings.ts";
import { openSettingsWindow } from "./settingsWindow.ts";
import "./chat.css";

export function ChatWindow() {
  const { t } = useTranslation();
  const messages = useChatStore((s) => s.messages);
  const streaming = useChatStore((s) => s.streaming);
  const partial = useChatStore((s) => s.partial);
  const error = useChatStore((s) => s.error);
  const send = useChatStore((s) => s.send);
  const regenerate = useChatStore((s) => s.regenerate);
  const stop = useChatStore((s) => s.stop);
  const clear = useChatStore((s) => s.clear);
  const clearError = useChatStore((s) => s.clearError);
  const mood = useChatStore(avatarMood);
  const companionName = useCompanionName();
  const keyReady = useSettingsStore(hasApiKey);
  const settings = useSettingsStore((s) => s.settings);
  const saveSettings = useSettingsStore((s) => s.save);
  // Restore the remembered window size and track user resizes.
  // Mins mirror the chat window's minWidth/minHeight in tauri.conf.json.
  useWindowSizeMemory("sage.chat-size", 300, 380);

  // Quick permission toggle for the local agent CLI: cycles the tier and saves
  // immediately (the next turn's `claude`/`codex` spawn picks it up in Rust).
  const permission = normalizePermission(settings.agent_cli_permission);
  const permissionTitle = t("chat.permissionToggle", {
    level: t(PERMISSION_LABEL_KEY[permission]),
  });

  // Load the persisted conversation once on mount. The store's not-streaming
  // guard makes this safe under React strict-mode's double-invoke; loadSession
  // works under the mock too, so hydrate unconditionally.
  useEffect(() => {
    void useChatStore.getState().hydrate();
  }, []);

  // The avatar lives in another webview with its own store instance —
  // mirror the mood over a Tauri event so it can animate along.
  useEffect(() => {
    if (!hasTauri()) return;
    void (async () => {
      const { emit } = await import("@tauri-apps/api/event");
      await emit(MOOD_EVENT, mood);
    })();
  }, [mood]);

  // S5.4 — mirror context samples broadcast by the avatar window (so send()
  // can inject them) and turn clicked bubbles into the assistant's opener.
  useEffect(() => {
    if (!hasTauri()) return;
    let disposed = false;
    const offs: (() => void)[] = [];
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const offContext = await listen<ContextEventPayload>(
        CONTEXT_EVENT,
        (event) => {
          useObservationStore
            .getState()
            .pushContext(event.payload.window, event.payload.at);
        },
      );
      const offBubble = await listen<BubbleOpenEventPayload>(
        BUBBLE_OPEN_EVENT,
        (event) => {
          useChatStore.getState().openFromBubble(event.payload.text);
        },
      );
      offs.push(offContext, offBubble);
      if (disposed) offs.forEach((off) => off());
    })();
    return () => {
      disposed = true;
      offs.forEach((off) => off());
    };
  }, []);

  const hideWindow = async () => {
    if (!hasTauri()) return;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().hide();
  };

  // Fallback resize handle: frameless windows expose no native resize border
  // on some platforms (notably Linux/GTK), so the grip drives it explicitly.
  const startResizeDrag = async () => {
    if (!hasTauri()) return;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().startResizeDragging("SouthEast");
  };

  return (
    <div className="chat-stage">
      <div className="chat-shell">
        <header className="chat-head" data-tauri-drag-region>
          <span className="chat-head-dot" aria-hidden data-tauri-drag-region />
          <span className="chat-title" data-tauri-drag-region>
            {companionName}
          </span>
          {settings.backend === "agent_cli" && (
            <button
              type="button"
              className="chat-head-btn"
              title={permissionTitle}
              aria-label={permissionTitle}
              onClick={() =>
                void saveSettings({ agent_cli_permission: nextPermission(permission) })
              }
            >
              {PERMISSION_ICON[permission]}
            </button>
          )}
          {messages.length > 0 && (
            <button
              type="button"
              className="chat-head-btn"
              title={t("chat.newConversation")}
              aria-label={t("chat.newConversation")}
              onClick={() => void clear()}
            >
              ✎
            </button>
          )}
          <button
            type="button"
            className="chat-head-btn"
            title={t("chat.settingsTitle")}
            aria-label={t("chat.settingsTitle")}
            onClick={() => void openSettingsWindow()}
          >
            ⚙
          </button>
          <button
            type="button"
            className="chat-head-btn"
            title={t("chat.hide")}
            aria-label={t("chat.hide")}
            onClick={() => void hideWindow()}
          >
            ×
          </button>
        </header>

        <MessageList
          messages={messages}
          partial={partial}
          streaming={streaming}
          onRegenerate={() => void regenerate()}
        />

        {error && (
          <div className="chat-error" role="alert">
            <span>{error}</span>
            <button
              type="button"
              onClick={clearError}
              aria-label={t("chat.dismissError")}
            >
              ×
            </button>
          </div>
        )}

        <Composer
          streaming={streaming}
          hasKey={keyReady}
          onSend={(text) => void send(text)}
          onStop={stop}
          onOpenSettings={() => void openSettingsWindow()}
        />

        <div
          className="chat-resize-grip"
          title={t("chat.resizeHandle")}
          aria-hidden
          onPointerDown={() => void startResizeDrag()}
        />
      </div>
    </div>
  );
}
