import { describe, expect, it } from "vitest";
import { startClock, summarizeJitter, TIMER_STRATEGIES, type ClockTick } from "./clock.js";

// Real timers throughout: these tests exercise actual platform timer behavior
// (setInterval/setTimeout/Atomics.wait jitter against hrtime). Fake timers
// cannot advance hrtime busy-spin loops, so deterministic time control will
// not work here. Durations are short (120 Hz, few ticks) to keep CI cheap.

function collect(strategy: (typeof TIMER_STRATEGIES)[number], ticks: number): Promise<ClockTick[]> {
  const { promise, resolve, reject } = Promise.withResolvers<ClockTick[]>();
  const got: ClockTick[] = [];
  const handle = startClock(strategy, {
    tickHz: 120,
    spinWindowMs: 0,
    ticks,
    onTick: (tick) => {
      got.push(tick);
      if (got.length >= ticks) {
        handle.stop();
        resolve(got);
      }
    },
  });
  setTimeout(() => reject(new Error(`${strategy} fired ${got.length}/${ticks} ticks in time`)), 5000);
  return promise;
}

describe("summarizeJitter", () => {
  it("computes nearest-rank quantiles like ShowHost.getMetrics", () => {
    expect(summarizeJitter([])).toEqual({ count: 0, p50Ms: 0, p99Ms: 0, maxMs: 0 });
    const summary = summarizeJitter([5, 1, 4, 2, 3]);
    expect(summary.count).toBe(5);
    expect(summary.p50Ms).toBe(3);
    expect(summary.p99Ms).toBe(4);
    expect(summary.maxMs).toBe(5);
  });
});

describe.each(TIMER_STRATEGIES)("clock strategy %s", (strategy) => {
  it("fires sequential ticks anchored to start with non-negative jitter", async () => {
    const ticks = await collect(strategy, 5);
    expect(ticks.map((tick) => tick.index)).toEqual([0, 1, 2, 3, 4]);
    const nominal = ticks[1]!.scheduledNs - ticks[0]!.scheduledNs;
    for (let i = 1; i < ticks.length; i += 1) {
      expect(ticks[i]!.scheduledNs - ticks[i - 1]!.scheduledNs).toBe(nominal);
      expect(ticks[i]!.jitterMs).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("startClock validation", () => {
  it("rejects unknown strategies and non-positive tick rates", () => {
    const noop = (): void => {};
    expect(() => startClock("ntp" as never, { tickHz: 60, onTick: noop })).toThrow(/unknown timer strategy/);
    expect(() => startClock("interval", { tickHz: 0, onTick: noop })).toThrow(/tickHz must be a positive number/);
  });

  // Real timers: asserts stop() actually silences the platform timer.
  it("stop is idempotent and ends the tick stream", async () => {
    const got: ClockTick[] = [];
    const handle = startClock("interval", { tickHz: 120, onTick: (tick) => got.push(tick) });
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 60);
    await promise;
    handle.stop();
    handle.stop();
    const frozen = got.length;
    expect(frozen).toBeGreaterThan(0);
    const { promise: wait, resolve: done } = Promise.withResolvers<void>();
    setTimeout(done, 60);
    await wait;
    expect(got.length).toBe(frozen);
  });
});
