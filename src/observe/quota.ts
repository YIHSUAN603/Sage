// Rolling-hour quota for proactive bubbles (the `maxPerHour` tuning).
// Pure so Node tests can cover it without the observation runner.

const HOUR_MS = 60 * 60 * 1000;

/** Drop timestamps older than one hour before `now`. */
export function pruneHourWindow(timestamps: number[], now: number): number[] {
  return timestamps.filter((t) => now - t < HOUR_MS);
}

/**
 * Whether another bubble may be shown at `now` given the bubbles already
 * shown (`timestamps`, epoch ms). `maxPerHour` 0 (or negative) = unlimited.
 */
export function underHourlyQuota(
  timestamps: number[],
  now: number,
  maxPerHour: number,
): boolean {
  if (maxPerHour <= 0) return true;
  return pruneHourWindow(timestamps, now).length < maxPerHour;
}
