// Renders a Codex pet spritesheet as an animated CSS sprite. Given the atlas
// data URL and the current mood, it picks the matching row (petAtlas.ts) and
// steps through that row's frames on the documented per-frame timing. The
// 192×208 cell is scaled down to sit in the tiny avatar window. Honors
// prefers-reduced-motion by holding the first frame.
import { useEffect, useRef, useState } from "react";
import type { AvatarMood } from "../store/chat.ts";
import { ATLAS, ROWS, rowForMood } from "./petAtlas.ts";

interface PetSpriteProps {
  atlasUrl: string;
  mood: AvatarMood;
  /** Cell scale factor. Default 0.88 → a ~169×183 footprint, like the SVG sprite. */
  scale?: number;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

export function PetSprite({ atlasUrl, mood, scale = 0.88 }: PetSpriteProps) {
  const reduced = usePrefersReducedMotion();
  const [frame, setFrame] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const row = rowForMood(mood);

  // Re-arm the frame loop whenever the row (mood) changes. Each frame is shown
  // for its own duration, then we advance and reschedule; single-frame rows or
  // reduced-motion just hold frame 0.
  useEffect(() => {
    const durations = ROWS[row].durations;
    setFrame(0);
    if (reduced || durations.length <= 1) return;

    let f = 0;
    const tick = () => {
      f = (f + 1) % durations.length;
      setFrame(f);
      timer.current = setTimeout(tick, durations[f]);
    };
    timer.current = setTimeout(tick, durations[0]);
    return () => clearTimeout(timer.current);
  }, [row, reduced]);

  const w = ATLAS.cellW * scale;
  const h = ATLAS.cellH * scale;

  return (
    <div
      className="pet-sprite"
      style={{ width: `${w}px`, height: `${h}px`, overflow: "hidden" }}
      aria-hidden
    >
      <div
        style={{
          width: `${ATLAS.cellW}px`,
          height: `${ATLAS.cellH}px`,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          backgroundImage: `url(${atlasUrl})`,
          backgroundRepeat: "no-repeat",
          backgroundSize: `${ATLAS.sheetW}px ${ATLAS.sheetH}px`,
          backgroundPosition: `-${frame * ATLAS.cellW}px -${row * ATLAS.cellH}px`,
          imageRendering: "pixelated",
        }}
      />
    </div>
  );
}
