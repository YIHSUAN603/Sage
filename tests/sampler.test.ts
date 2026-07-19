import { test } from "node:test";
import assert from "node:assert/strict";
import type { ActiveWindow } from "../src/ipc/contract.ts";
import { createMockIpc } from "../src/ipc/mock.ts";
import { createSampler, type SamplerOptions } from "../src/observe/sampler.ts";

/** Manual scheduler: collects scheduled callbacks so tests fire them by hand. */
function manualTimers() {
  const queue: { fn: () => void; ms: number; cancelled: boolean }[] = [];
  return {
    queue,
    schedule(fn: () => void, ms: number): unknown {
      const entry = { fn, ms, cancelled: false };
      queue.push(entry);
      return entry;
    },
    cancel(handle: unknown): void {
      (handle as { cancelled: boolean }).cancelled = true;
    },
    /** Fire the next pending callback and let the async tick settle. */
    async fire(index: number): Promise<void> {
      queue[index].fn();
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

function collect() {
  const samples: { window: ActiveWindow | null; at: number }[] = [];
  const onSample: SamplerOptions["onSample"] = (window, at) => {
    samples.push({ window, at });
  };
  return { samples, onSample };
}

test("samples immediately on start, then on the injected cadence", async () => {
  const ipc = createMockIpc({
    windows: [{ app_name: "Code", title: "a.ts" }, null],
  });
  const timers = manualTimers();
  const { samples, onSample } = collect();
  let clock = 1_000;

  const sampler = createSampler({
    ipc,
    intervalMs: 5_000,
    onSample,
    now: () => clock,
    schedule: timers.schedule,
    cancel: timers.cancel,
  });

  sampler.start();
  assert.equal(sampler.running(), true);
  assert.equal(timers.queue.length, 1);
  assert.equal(timers.queue[0].ms, 0); // first poll fires immediately

  await timers.fire(0);
  assert.deepEqual(samples, [
    { window: { app_name: "Code", title: "a.ts" }, at: 1_000 },
  ]);
  // The next poll was scheduled at the configured interval.
  assert.equal(timers.queue.length, 2);
  assert.equal(timers.queue[1].ms, 5_000);

  clock = 6_000;
  await timers.fire(1);
  assert.equal(samples.length, 2);
  assert.deepEqual(samples[1], { window: null, at: 6_000 }); // cycles the fixtures
});

test("stop cancels the pending poll and drops in-flight results", async () => {
  const ipc = createMockIpc({ windows: [{ app_name: "Code", title: "a.ts" }] });
  const timers = manualTimers();
  const { samples, onSample } = collect();

  const sampler = createSampler({
    ipc,
    intervalMs: 5_000,
    onSample,
    schedule: timers.schedule,
    cancel: timers.cancel,
  });

  sampler.start();
  await timers.fire(0);
  assert.equal(samples.length, 1);

  sampler.stop();
  assert.equal(sampler.running(), false);
  assert.equal(timers.queue[1].cancelled, true);

  // Even if the cancelled callback somehow fires, no sample lands.
  await timers.fire(1);
  assert.equal(samples.length, 1);
  assert.equal(timers.queue.length, 2); // and nothing new was scheduled
});

test("an activeWindow failure records a null sample and keeps polling", async () => {
  const failingIpc = {
    activeWindow: async () => {
      throw new Error("backend gone");
    },
  };
  const timers = manualTimers();
  const { samples, onSample } = collect();

  const sampler = createSampler({
    ipc: failingIpc,
    intervalMs: 3_000,
    onSample,
    schedule: timers.schedule,
    cancel: timers.cancel,
  });

  sampler.start();
  await timers.fire(0);
  assert.equal(samples.length, 1);
  assert.equal(samples[0].window, null);
  assert.equal(timers.queue.length, 2); // still rescheduled after the failure
});

test("start is idempotent while running", () => {
  const ipc = createMockIpc();
  const timers = manualTimers();
  const { onSample } = collect();

  const sampler = createSampler({
    ipc,
    intervalMs: 5_000,
    onSample,
    schedule: timers.schedule,
    cancel: timers.cancel,
  });

  sampler.start();
  sampler.start();
  assert.equal(timers.queue.length, 1);
});
