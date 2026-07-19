// S5.1 — Context sampler: polls active_window() on a fixed cadence and hands
// every sample to the caller. Start/stop only — deciding whether observation
// should run at all (observe_enabled, interval changes) is the runner's job.
// Clock and timers are injectable so Node tests can drive the cadence by hand.
import type { ActiveWindow, SageIpc } from "../ipc/contract.ts";

export interface SamplerOptions {
  ipc: Pick<SageIpc, "activeWindow">;
  /** Delay between polls. The first poll fires immediately on start(). */
  intervalMs: number;
  /** Called after each poll. `at` is the sample time in epoch ms. */
  onSample(window: ActiveWindow | null, at: number): void;
  now?(): number;
  schedule?(fn: () => void, ms: number): unknown;
  cancel?(handle: unknown): void;
}

export interface Sampler {
  start(): void;
  stop(): void;
  running(): boolean;
}

export function createSampler(options: SamplerOptions): Sampler {
  const now = options.now ?? Date.now;
  const schedule =
    options.schedule ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const cancel =
    options.cancel ??
    ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  let active = false;
  let handle: unknown = null;

  async function tick(): Promise<void> {
    if (!active) return;
    let window: ActiveWindow | null = null;
    try {
      window = await options.ipc.activeWindow();
    } catch {
      window = null; // contract: unavailable ⇒ null, never throws upward
    }
    // stop() may have landed while awaiting — drop the result silently.
    if (!active) return;
    options.onSample(window, now());
    handle = schedule(() => void tick(), options.intervalMs);
  }

  return {
    start() {
      if (active) return;
      active = true;
      // Immediate first sample so context is available right after enabling.
      handle = schedule(() => void tick(), 0);
    },

    stop() {
      if (!active) return;
      active = false;
      if (handle !== null) cancel(handle);
      handle = null;
    },

    running() {
      return active;
    },
  };
}
