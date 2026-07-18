// S4.2 — The speech-bubble chat window: frameless rounded card that sits
// next to the avatar. Streams live via the chat store and broadcasts the
// avatar mood over a Tauri event so the avatar webview can animate.
import { useEffect, useState } from "react";
import { Composer } from "../components/Composer.tsx";
import { MessageList } from "../components/MessageList.tsx";
import { SettingsDialog } from "../components/SettingsDialog.tsx";
import { fetchFreeToolModels, fetchFreeVisionModels } from "../llm/models.ts";
import { hasTauri } from "../runtime.ts";
import { avatarMood, MOOD_EVENT, useChatStore } from "../store/chat.ts";
import { hasApiKey, useSettingsStore } from "../store/settings.ts";
import "./chat.css";

// Module-level so the references stay stable across renders (the dialog's
// load effect depends on them).
const loadChatModels = () => fetchFreeToolModels();
const loadObserveModels = () => fetchFreeVisionModels();

export function ChatWindow() {
  const messages = useChatStore((s) => s.messages);
  const streaming = useChatStore((s) => s.streaming);
  const partial = useChatStore((s) => s.partial);
  const error = useChatStore((s) => s.error);
  const send = useChatStore((s) => s.send);
  const stop = useChatStore((s) => s.stop);
  const clearError = useChatStore((s) => s.clearError);
  const mood = useChatStore(avatarMood);
  const keyReady = useSettingsStore(hasApiKey);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // The avatar lives in another webview with its own store instance —
  // mirror the mood over a Tauri event so it can animate along.
  useEffect(() => {
    if (!hasTauri()) return;
    void (async () => {
      const { emit } = await import("@tauri-apps/api/event");
      await emit(MOOD_EVENT, mood);
    })();
  }, [mood]);

  const hideWindow = async () => {
    if (!hasTauri()) return;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().hide();
  };

  return (
    <div className="chat-stage">
      <div className="chat-shell">
        <header className="chat-head" data-tauri-drag-region>
          <span className="chat-head-dot" aria-hidden data-tauri-drag-region />
          <span className="chat-title" data-tauri-drag-region>
            Sage
          </span>
          <button
            type="button"
            className="chat-head-btn"
            title="設定"
            aria-label="設定"
            onClick={() => setSettingsOpen(true)}
          >
            ⚙
          </button>
          <button
            type="button"
            className="chat-head-btn"
            title="收起"
            aria-label="收起"
            onClick={() => void hideWindow()}
          >
            ×
          </button>
        </header>

        <MessageList messages={messages} partial={partial} streaming={streaming} />

        {error && (
          <div className="chat-error" role="alert">
            <span>{error}</span>
            <button
              type="button"
              onClick={clearError}
              aria-label="關閉錯誤訊息"
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
          onOpenSettings={() => setSettingsOpen(true)}
        />

        <SettingsDialog
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          loadChatModels={loadChatModels}
          loadObserveModels={loadObserveModels}
        />
      </div>
    </div>
  );
}
