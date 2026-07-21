// S4.1 — The floating desktop companion: a hand-drawn sage-leaf sprite in a
// tiny transparent always-on-top window. Drag anywhere to move the window;
// a click (mousedown/mouseup within a small threshold) toggles the chat
// bubble. Mood (idle/thinking/talking) is driven by the chat window over a
// Tauri event, falling back to the local chat store in pure-browser dev.
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { useObservation } from "../observe/runner.ts";
import { BUBBLE_EVENT } from "../events.ts";
import { hasTauri } from "../runtime.ts";
import { requireIpc } from "../store/ipc.ts";
import { useCompanionName } from "../store/companion.ts";
import { avatarMood, MOOD_EVENT, type AvatarMood, useChatStore } from "../store/chat.ts";
import { useSettingsStore } from "../store/settings.ts";
import { useSettingsSync } from "../store/settingsSync.ts";
import { toggleChatWindow } from "./chatToggle.ts";
import { PetSprite } from "./PetSprite.tsx";
import type { AvatarGesture } from "./petAtlas.ts";
import "./avatar.css";

/** Movement beyond this many px turns a press into a window drag. */
const DRAG_THRESHOLD = 4;

// Transient gesture timings (ms). Jump lasts one jumping cycle; after this much
// idle the pet runs a lap (out then back, each half this long).
const JUMP_MS = 840;
const IDLE_RUN_AFTER_MS = 90_000;
const RUN_LAP_HALF_MS = 800;

export function AvatarWindow() {
  const { t } = useTranslation();
  const name = useCompanionName();
  const localMood = useChatStore(avatarMood);
  const [eventMood, setEventMood] = useState<AvatarMood | null>(null);
  const mood = eventMood ?? localMood;

  // Transient gesture that briefly overrides the mood row on the spritesheet
  // (drag → run, bubble → jump, long idle → run a lap). Fixed-duration gestures
  // go through playGesture; the drag gesture is held for the whole drag below.
  const [gesture, setGesture] = useState<AvatarGesture | null>(null);
  const gestureTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lapTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const playGesture = (g: AvatarGesture, ms: number) => {
    clearTimeout(gestureTimer.current);
    setGesture(g);
    gestureTimer.current = setTimeout(() => setGesture(null), ms);
  };

  // Dragging has two paths, chosen by whether window positioning actually works
  // (probed once at startup):
  //  • positioning works (X11 / Windows / macOS) → we move the window ourselves
  //    with setPosition; pointer events keep streaming, so direction updates
  //    live mid-drag and release is caught immediately.
  //  • positioning broken (Wayland/WSLg, outerPosition returns (0,0)) → only a
  //    native compositor move works, during which the pointer coords the webview
  //    sees are noise; we fix the direction at drag start and just catch release.
  const press = useRef<{ x: number; y: number } | null>(null);
  const dragging = useRef(false);
  const grab = useRef<{ x: number; y: number } | null>(null);
  const dragCleanup = useRef<(() => void) | undefined>(undefined);
  const winRef = useRef<import("@tauri-apps/api/window").Window | null>(null);
  const physPosRef = useRef<typeof import("@tauri-apps/api/dpi").PhysicalPosition | null>(null);
  const positioningWorks = useRef(false);
  useEffect(() => {
    if (!hasTauri()) return;
    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const { PhysicalPosition } = await import("@tauri-apps/api/dpi");
        const win = getCurrentWindow();
        winRef.current = win;
        physPosRef.current = PhysicalPosition;
        // (0,0) means the compositor hides the real position (Wayland) — a
        // reliable signal that setPosition won't work either.
        const pos = await win.outerPosition();
        positioningWorks.current = pos.x !== 0 || pos.y !== 0;
      } catch (err) {
        if (import.meta.env.DEV) console.error("[sage:drag] init failed", err);
      }
    })();
  }, []);
  useEffect(
    () => () => {
      clearTimeout(gestureTimer.current);
      dragCleanup.current?.();
    },
    [],
  );

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

  // Proactive bubble → jump. The bubble is broadcast globally (runner.ts), so
  // this window receives its own emit too.
  useEffect(() => {
    if (!hasTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const off = await listen(BUBBLE_EVENT, () => playGesture("jump", JUMP_MS));
      if (disposed) off();
      else unlisten = off;
    })();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // Long idle → run a lap (out then back). Keyed on mood only: leaving idle
  // clears the countdown and drops any leftover run gesture so the mood row
  // (thinking/talking) takes over immediately.
  useEffect(() => {
    if (mood !== "idle") return;
    idleTimer.current = setTimeout(() => {
      setGesture("run-right");
      lapTimer.current = setTimeout(() => {
        setGesture("run-left");
        lapTimer.current = setTimeout(() => setGesture(null), RUN_LAP_HALF_MS);
      }, RUN_LAP_HALF_MS);
    }, IDLE_RUN_AFTER_MS);
    return () => {
      clearTimeout(idleTimer.current);
      clearTimeout(lapTimer.current);
      setGesture((g) => (g === "run-left" || g === "run-right" ? null : g));
    };
  }, [mood]);

  // Begin a drag (threshold crossed). Follow the pointer on the window so we
  // catch every move/release regardless of which path is active. `dx` is the
  // opening motion, used for the initial run direction.
  const beginDrag = (dx: number) => {
    dragging.current = true;
    setGesture(dx < 0 ? "run-left" : "run-right");
    const manual = positioningWorks.current;
    const scale = window.devicePixelRatio || 1;
    let lastX = press.current?.x ?? 0;

    const onMove = (ev: PointerEvent) => {
      // Only trust coords for direction where positioning works — under a
      // Wayland compositor move they're noise, so keep the opening direction.
      if (!manual) return;
      const ddx = ev.screenX - lastX;
      if (ddx <= -1) setGesture("run-left");
      else if (ddx >= 1) setGesture("run-right");
      lastX = ev.screenX;
      const g = grab.current;
      const PhysicalPosition = physPosRef.current;
      if (g && PhysicalPosition && winRef.current) {
        const left = Math.round((ev.screenX - g.x) * scale);
        const top = Math.round((ev.screenY - g.y) * scale);
        void winRef.current.setPosition(new PhysicalPosition(left, top)).catch((err) => {
          if (import.meta.env.DEV) console.error("[sage:drag] setPosition failed", err);
        });
      }
    };
    const finish = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("blur", finish);
      dragCleanup.current = undefined;
      press.current = null;
      dragging.current = false;
      grab.current = null;
      setGesture(null); // release → stop running immediately
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("blur", finish);
    dragCleanup.current = finish;

    // Wayland: hand the move to the compositor (the only thing that works there).
    // Elsewhere: we move the window ourselves in onMove via setPosition.
    if (!manual) {
      void winRef.current?.startDragging().catch((err) => {
        if (import.meta.env.DEV) console.error("[sage:drag] startDragging failed", err);
      });
    }
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    press.current = { x: e.screenX, y: e.screenY };
    dragging.current = false;
    // Grab offset within the window, so the manual path can keep this point under
    // the cursor via setPosition. Unused on the Wayland (native) path.
    grab.current = { x: e.clientX, y: e.clientY };
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    if (!press.current || dragging.current) return;
    const dx = e.screenX - press.current.x;
    const dy = e.screenY - press.current.y;
    if (Math.hypot(dx, dy) <= DRAG_THRESHOLD) return;
    // Manual path: capture so a fast cursor that briefly outruns the window still
    // delivers moves (auto-releases on pointerup). Not used on the native path.
    if (positioningWorks.current) {
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* unsupported — fine */
      }
    }
    beginDrag(dx); // crossed the threshold — it's a drag, not a click
  };

  const onPointerUp = () => {
    // A drag ends via the global listeners in beginDrag; here we only handle the
    // no-drag case: a plain click toggles the chat window.
    if (!press.current || dragging.current) return;
    press.current = null;
    grab.current = null;
    void toggleChatWindow();
  };

  return (
    <div className="avatar-stage">
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
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <div className="sprite-bob">
          {atlasUrl ? (
            <PetSprite atlasUrl={atlasUrl} mood={mood} gesture={gesture} />
          ) : (
          <svg
            className="sprite-svg"
            viewBox="0 0 96 96"
            width="170"
            height="170"
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
