// S5.2 — "Worth mentioning?" heuristics over a sequence of active-window
// samples. Pure function; thresholds are injectable for tests and tuning.

export interface WindowSample {
  app_name: string;
  title: string;
  /** Sample time, epoch milliseconds. */
  at: number;
}

export interface NotableResult {
  notable: boolean;
  /** Human-readable trigger explanation; "" when not notable. */
  reason: string;
}

export interface NotableOptions {
  /** Rule 1 — same window for at least this long looks stuck. Default 15 min. */
  stuckMs?: number;
  /** Rule 2 — look-back window for rapid switching. Default 2 min. */
  rapidSwitchWindowMs?: number;
  /** Rule 2 — switches within the look-back window to trigger. Default 6. */
  rapidSwitchCount?: number;
  /** Rule 3 — a sampling gap this long counts as idle. Default 5 min. */
  idleGapMs?: number;
}

const DEFAULTS: Required<NotableOptions> = {
  stuckMs: 15 * 60_000,
  rapidSwitchWindowMs: 2 * 60_000,
  rapidSwitchCount: 6,
  idleGapMs: 5 * 60_000,
};

function sameWindow(a: WindowSample, b: WindowSample): boolean {
  return a.app_name === b.app_name && a.title === b.title;
}

function minutes(ms: number): string {
  return `${Math.round(ms / 60_000)} min`;
}

/**
 * Decide whether the recent window activity is worth speaking up about.
 * Rules, in priority order:
 *  1. idle-return — the latest sample arrived after a long sampling gap;
 *  2. rapid switching — many window switches within a short look-back window;
 *  3. stuck — the same window has been focused continuously for too long.
 */
export function assessNotable(
  samples: WindowSample[],
  options: NotableOptions = {},
): NotableResult {
  const opts = { ...DEFAULTS, ...options };
  if (samples.length < 2) return { notable: false, reason: "" };

  const last = samples[samples.length - 1];
  const prev = samples[samples.length - 2];

  // Rule 3 (idle-return): sampling stopped for a while, then resumed.
  const lastGap = last.at - prev.at;
  if (lastGap >= opts.idleGapMs) {
    return {
      notable: true,
      reason: `back after ${minutes(lastGap)} idle (now in ${last.app_name})`,
    };
  }

  // Rule 2 (rapid switching): count window changes inside the look-back window.
  const windowStart = last.at - opts.rapidSwitchWindowMs;
  let switches = 0;
  for (let i = samples.length - 1; i > 0 && samples[i].at >= windowStart; i -= 1) {
    if (!sameWindow(samples[i], samples[i - 1])) switches += 1;
  }
  if (switches >= opts.rapidSwitchCount) {
    return {
      notable: true,
      reason: `${switches} window switches in the last ${minutes(opts.rapidSwitchWindowMs)}`,
    };
  }

  // Rule 1 (stuck): trailing run of the same window, broken by idle gaps so
  // time spent away from the machine never counts as focus time.
  let runStart = samples.length - 1;
  while (
    runStart > 0 &&
    sameWindow(samples[runStart - 1], last) &&
    samples[runStart].at - samples[runStart - 1].at < opts.idleGapMs
  ) {
    runStart -= 1;
  }
  const dwell = last.at - samples[runStart].at;
  if (dwell >= opts.stuckMs) {
    return {
      notable: true,
      reason: `${minutes(dwell)} on the same window: ${last.app_name} — ${last.title}`,
    };
  }

  return { notable: false, reason: "" };
}
