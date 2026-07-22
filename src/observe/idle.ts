// Idle-signal policy: when the user has been away from keyboard and mouse for
// long enough, proactive asks are pointless (nobody is there to read the
// bubble) — the runner skips the LLM call entirely and just reschedules.
// Applies to both observation and idle-chatter mode.

/** Seconds of no keyboard/mouse input after which proactive asks are skipped. */
export const IDLE_SKIP_SECONDS = 600;

/**
 * Whether a proactive ask should be skipped because the user is away.
 * `idleSeconds` comes from `ipc.activityState()` (0 when undetectable, so an
 * unknown idle time never silences the companion).
 */
export function shouldSkipWhenIdle(
  idleSeconds: number,
  threshold = IDLE_SKIP_SECONDS,
): boolean {
  return idleSeconds >= threshold;
}
