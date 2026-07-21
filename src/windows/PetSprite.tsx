// Renders a Codex pet spritesheet as an animated CSS sprite. Given the atlas
// data URL and the current mood, it picks the matching row (petAtlas.ts) and
// steps through that row's frames on the documented per-frame timing. The
// 192×208 cell is scaled down to sit in the tiny avatar window. Honors
// prefers-reduced-motion by holding the first frame.
import { useEffect, useRef, useState } from "react";
import type { AvatarMood } from "../store/chat.ts";
import {
  ATLAS,
  type AvatarGesture,
  gestureFlipsX,
  ROWS,
  rowForGesture,
  rowForMood,
} from "./petAtlas.ts";

interface PetSpriteProps {
  atlasUrl: string;
  mood: AvatarMood;
  /** Transient gesture that overrides the mood row while set (drag/bubble/idle). */
  gesture?: AvatarGesture | null;
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

export function PetSprite({ atlasUrl, mood, gesture, scale = 0.88 }: PetSpriteProps) {
  const reduced = usePrefersReducedMotion();
  const [frame, setFrame] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // A gesture temporarily wins over the mood row; the frame loop below re-arms
  // on row change, so playing and reverting both animate for free.
  const row = gesture ? rowForGesture(gesture) : rowForMood(mood);
  const flip = gesture ? gestureFlipsX(gesture) : false;

  // The cell size (192×208) is fixed across sprite versions, but the total
  // sheet height is not: v1 sheets are 9 rows (1872px), v2 sheets 11 rows
  // (2288px). Read the real dimensions from the image so backgroundSize matches
  // it exactly — otherwise the image is squished to the hardcoded size and each
  // cell sample bleeds into the neighbouring row. Falls back to the documented
  // v1 size until the image loads.
  const [sheet, setSheet] = useState<{ w: number; h: number }>({
    w: ATLAS.sheetW,
    h: ATLAS.sheetH,
  });
  useEffect(() => {
    const img = new Image();
    img.onload = () => setSheet({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = atlasUrl;
  }, [atlasUrl]);

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
      style={{
        width: `${w}px`,
        height: `${h}px`,
        overflow: "hidden",
        transform: flip ? "scaleX(-1)" : undefined,
      }}
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
          backgroundSize: `${sheet.w}px ${sheet.h}px`,
          backgroundPosition: `-${frame * ATLAS.cellW}px -${row * ATLAS.cellH}px`,
          imageRendering: "pixelated",
        }}
      />
    </div>
  );
}
