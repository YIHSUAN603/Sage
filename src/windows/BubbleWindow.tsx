// S5.4 — The proactive speech bubble: a tiny always-on-top window shown above
// the avatar by observe/runner.ts. Auto-hides after a short while (hover
// pauses the countdown); clicking it hands the remark to the chat window and
// opens the conversation; × just dismisses.
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  BUBBLE_EVENT,
  BUBBLE_OPEN_EVENT,
  type BubbleEventPayload,
  type BubbleOpenEventPayload,
} from "../events.ts";
import { hasTauri } from "../runtime.ts";
import { showChatWindow } from "./chatToggle.ts";
import "./bubble.css";

const AUTO_HIDE_MS = 12_000;

export function BubbleWindow() {
  const { t } = useTranslation();
  const [bubble, setBubble] = useState<BubbleEventPayload | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const hide = async () => {
    clearTimer();
    setBubble(null);
    if (!hasTauri()) return;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().hide();
  };

  const armTimer = () => {
    clearTimer();
    timer.current = setTimeout(() => void hide(), AUTO_HIDE_MS);
  };

  useEffect(() => {
    if (!hasTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const off = await listen<BubbleEventPayload>(BUBBLE_EVENT, (event) => {
        setBubble(event.payload);
        armTimer();
      });
      if (disposed) off();
      else unlisten = off;
    })();
    return () => {
      disposed = true;
      unlisten?.();
      clearTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const open = async () => {
    if (!bubble) return;
    if (hasTauri()) {
      const { emit } = await import("@tauri-apps/api/event");
      const payload: BubbleOpenEventPayload = {
        text: bubble.text,
        reason: bubble.reason,
      };
      await emit(BUBBLE_OPEN_EVENT, payload);
    }
    await showChatWindow();
    await hide();
  };

  return (
    <div className="bubble-stage">
      {bubble && (
        <div
          className="bubble-card"
          role="button"
          title={bubble.reason}
          onClick={() => void open()}
          onMouseEnter={clearTimer}
          onMouseLeave={armTimer}
        >
          <span className="bubble-text">{bubble.text}</span>
          <button
            type="button"
            className="bubble-close"
            aria-label={t("bubble.close")}
            onClick={(e) => {
              e.stopPropagation();
              void hide();
            }}
          >
            ×
          </button>
          <span className="bubble-tail" aria-hidden />
        </div>
      )}
    </div>
  );
}
