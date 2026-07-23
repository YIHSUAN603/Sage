// Remember a window's user-chosen size across launches (chat + avatar). The
// size is local UI state, so it lives in the webview's localStorage rather
// than settings.json (resize is high-frequency; settings saves broadcast to
// every window). Both webviews boot hidden or tiny at app start, so restoring
// here always lands before the user looks — no visible jump.
import { useEffect } from "react";
import { hasTauri } from "../runtime.ts";

const SAVE_DEBOUNCE_MS = 300;

interface StoredSize {
  width: number;
  height: number;
}

/** Restore `storageKey`'s saved size on mount and track user resizes.
 * `minWidth`/`minHeight` should mirror the window's mins in tauri.conf.json. */
export function useWindowSizeMemory(
  storageKey: string,
  minWidth: number,
  minHeight: number,
): void {
  useEffect(() => {
    if (!hasTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    void (async () => {
      const { getCurrentWindow, LogicalSize, currentMonitor } = await import(
        "@tauri-apps/api/window"
      );
      const win = getCurrentWindow();

      const saved = readStoredSize(storageKey);
      if (saved) {
        try {
          const monitor = await currentMonitor();
          const bounds = monitor
            ? monitor.size.toLogical(monitor.scaleFactor)
            : null;
          const width = clamp(saved.width, minWidth, bounds?.width);
          const height = clamp(saved.height, minHeight, bounds?.height);
          await win.setSize(new LogicalSize(width, height));
        } catch (err) {
          console.warn(`[sage] restore ${storageKey} failed`, err);
        }
      }

      const off = await win.onResized((event) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          void (async () => {
            try {
              const logical = event.payload.toLogical(await win.scaleFactor());
              const next: StoredSize = {
                width: Math.round(logical.width),
                height: Math.round(logical.height),
              };
              localStorage.setItem(storageKey, JSON.stringify(next));
            } catch {
              // Persisting the size is best-effort.
            }
          })();
        }, SAVE_DEBOUNCE_MS);
      });
      if (disposed) off();
      else unlisten = off;
    })();

    return () => {
      disposed = true;
      unlisten?.();
      if (timer) clearTimeout(timer);
    };
  }, [storageKey, minWidth, minHeight]);
}

function readStoredSize(storageKey: string): StoredSize | null {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as StoredSize).width === "number" &&
      typeof (parsed as StoredSize).height === "number" &&
      Number.isFinite((parsed as StoredSize).width) &&
      Number.isFinite((parsed as StoredSize).height)
    ) {
      return parsed as StoredSize;
    }
  } catch {
    // Corrupt entry — fall back to the configured default size.
  }
  return null;
}

function clamp(value: number, min: number, max: number | undefined | null): number {
  const bounded = max && max > min ? Math.min(value, max) : value;
  return Math.max(bounded, min);
}
