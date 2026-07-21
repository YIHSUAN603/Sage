// S4.1 — The floating desktop companion: a hand-drawn sage-leaf sprite in a
// tiny transparent always-on-top window. Drag anywhere to move the window;
// a click (mousedown/mouseup within a small threshold) toggles the chat
// bubble. Mood (idle/thinking/talking) is driven by the chat window over a
// Tauri event, falling back to the local chat store in pure-browser dev.
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { useObservation } from "../observe/runner.ts";
import { hasTauri } from "../runtime.ts";
import { requireIpc } from "../store/ipc.ts";
import { useCompanionName } from "../store/companion.ts";
import { avatarMood, MOOD_EVENT, type AvatarMood, useChatStore } from "../store/chat.ts";
import { useSettingsStore } from "../store/settings.ts";
import { useSettingsSync } from "../store/settingsSync.ts";
import { toggleChatWindow } from "./chatToggle.ts";
import { PetSprite } from "./PetSprite.tsx";
import "./avatar.css";

/** Movement beyond this many px turns a press into a window drag. */
const DRAG_THRESHOLD = 4;

export function AvatarWindow() {
  const { t } = useTranslation();
  const name = useCompanionName();
  const localMood = useChatStore(avatarMood);
  const [eventMood, setEventMood] = useState<AvatarMood | null>(null);
  const mood = eventMood ?? localMood;
  const press = useRef<{ x: number; y: number } | null>(null);

  // Selected companion: when one is set, render its spritesheet; on any load
  // failure (or none selected) fall back to the built-in SVG. Atlas is fetched
  // once per active_pet change and cached in state as a data URL.
  const activePet = useSettingsStore((s) => s.settings.active_pet);
  const [atlasUrl, setAtlasUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const id = activePet.trim();
    if (!id) {
      setAtlasUrl(null);
      return;
    }
    void (async () => {
      try {
        const url = await requireIpc().readPetAtlas(id);
        if (!cancelled) setAtlasUrl(url);
      } catch {
        if (!cancelled) setAtlasUrl(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activePet]);

  // S5.1–S5.3 run here — the avatar webview is the only one always visible,
  // so its timers never get throttled. Badge shows while observing.
  useSettingsSync();
  const { observing, devForceAsk, devFakeBubble } = useObservation();
  const pauseObservation = () =>
    void useSettingsStore.getState().save({ observe_enabled: false });

  useEffect(() => {
    if (!hasTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const off = await listen<AvatarMood>(MOOD_EVENT, (event) => {
        setEventMood(event.payload);
      });
      if (disposed) off();
      else unlisten = off;
    })();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const onMouseDown = (e: ReactMouseEvent) => {
    if (e.button !== 0) return;
    press.current = { x: e.screenX, y: e.screenY };
  };

  const onMouseMove = (e: ReactMouseEvent) => {
    if (!press.current) return;
    const dx = e.screenX - press.current.x;
    const dy = e.screenY - press.current.y;
    if (Math.hypot(dx, dy) <= DRAG_THRESHOLD) return;
    press.current = null; // it's a drag, not a click
    if (hasTauri()) {
      void (async () => {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().startDragging();
      })();
    }
  };

  const onMouseUp = () => {
    if (!press.current) return;
    press.current = null;
    void toggleChatWindow();
  };

  return (
    <div className="avatar-stage" data-tauri-drag-region>
      {observing && (
        <button
          type="button"
          className="observe-badge"
          title={t("avatar.observing")}
          aria-label={t("avatar.pauseObserve")}
          onClick={pauseObservation}
        >
          👁
        </button>
      )}
      {devForceAsk && (
        <button
          type="button"
          className="observe-badge dev-test-badge"
          title={t("avatar.devTest")}
          aria-label={t("avatar.devTestAria")}
          onClick={(e) => (e.shiftKey ? devFakeBubble?.() : devForceAsk())}
        >
          🧪
        </button>
      )}
      <div
        className={`sage-sprite mood-${mood}`}
        role="button"
        aria-label={t("avatar.toggleChat")}
        title={t("avatar.sprite", { name })}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={() => {
          press.current = null;
        }}
      >
        <div className="sprite-bob">
          {atlasUrl ? (
            <PetSprite atlasUrl={atlasUrl} mood={mood} />
          ) : (
          <svg
            className="sprite-svg"
            viewBox="0 0 96 96"
            width="96"
            height="96"
            aria-hidden
          >
            <defs>
              <linearGradient id="leaf-body" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#A9C89B" />
                <stop offset="1" stopColor="#7FA36F" />
              </linearGradient>
            </defs>
            {/* 圓潤的鼠尾草葉身體 */}
            <path
              className="body"
              d="M48 12 C31 23 19 39 19 57 C19 74 32 86 48 86 C64 86 77 74 77 57 C77 39 65 23 48 12 Z"
              fill="url(#leaf-body)"
              stroke="#5E7F52"
              strokeWidth="2"
              strokeLinejoin="round"
            />
            {/* 葉脈 */}
            <path
              d="M48 20 C46.5 36 46.5 60 48 80"
              stroke="#5E7F52"
              strokeWidth="1.5"
              fill="none"
              opacity="0.3"
            />
            <path
              d="M47.5 34 C42 37 37 41 33 47 M47.6 46 C42 49 37 53 33.5 58"
              stroke="#5E7F52"
              strokeWidth="1.2"
              fill="none"
              opacity="0.22"
            />
            <path
              d="M48.5 34 C54 37 59 41 63 47 M48.4 46 C54 49 59 53 62.5 58"
              stroke="#5E7F52"
              strokeWidth="1.2"
              fill="none"
              opacity="0.22"
            />
            {/* 頭頂小芽 */}
            <g className="sprout">
              <path
                d="M48 13 C48 8 50 4.5 54.5 3.5 C54.5 8.5 52 12 48 13 Z"
                fill="#8FB07E"
                stroke="#5E7F52"
                strokeWidth="1.2"
                strokeLinejoin="round"
              />
              <path
                d="M48 13 C47 9 44.5 6.5 40.5 6.5 C41.5 10.5 44.5 12.8 48 13 Z"
                fill="#9FC08C"
                stroke="#5E7F52"
                strokeWidth="1.2"
                strokeLinejoin="round"
              />
            </g>
            {/* 眼睛（CSS 眨眼） */}
            <g className="eyes">
              <ellipse cx="38" cy="55" rx="4.2" ry="5.6" fill="#2F3A2E" />
              <ellipse cx="58" cy="55" rx="4.2" ry="5.6" fill="#2F3A2E" />
              <circle cx="39.6" cy="52.8" r="1.5" fill="#F4F8EF" />
              <circle cx="59.6" cy="52.8" r="1.5" fill="#F4F8EF" />
            </g>
            {/* 腮紅 */}
            <ellipse cx="30.5" cy="63" rx="4.2" ry="2.4" fill="#E8A79E" opacity="0.75" />
            <ellipse cx="65.5" cy="63" rx="4.2" ry="2.4" fill="#E8A79E" opacity="0.75" />
            {/* 嘴：idle/thinking 微笑，talking 換成開口動畫 */}
            <path
              className="mouth-smile"
              d="M44 66 Q48 70 52 66"
              stroke="#2F3A2E"
              strokeWidth="2"
              strokeLinecap="round"
              fill="none"
            />
            <ellipse
              className="mouth-open"
              cx="48"
              cy="67.5"
              rx="4"
              ry="3.2"
              fill="#2F3A2E"
            />
          </svg>
          )}
          <div className="think-dots" aria-hidden>
            <span />
            <span />
            <span />
          </div>
        </div>
        <div className="sprite-shadow" aria-hidden />
      </div>
    </div>
  );
}
