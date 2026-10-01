// AutoLight show tick clock (T-ARC-06, DS-08).
//
// Three timer strategies drive the show tick. Every strategy anchors scheduled
// times to the start instant so long-run drift cannot accumulate; only the
// wait mechanism differs:
//
//   interval      drift-corrected setInterval, scheduled times anchored to
//                 start, missed ticks skipped so the phase never walks.
//   timeout-spin  setTimeout for the coarse wait plus a busy-wait tail that
//                 covers the last runtime.clock.spinWindowMs.
//   hybrid        Atomics.wait coarse sleep plus a spin tail for the last
//                 spinWindowMs. Needs a thread where Atomics.wait is allowed
//                 (the show host worker thread); elsewhere it degrades to the
//                 timeout-spin shape. Default per DS-08.
//
// Jitter per tick is actual minus scheduled, floored at zero, in milliseconds.
// Every timer callback is an explicit closure over the hrtime source: neither
// setInterval nor setTimeout supplies a timestamp argument.

export const TIMER_STRATEGIES = ["interval", "timeout-spin", "hybrid"] as const;
export type TimerStrategy = (typeof TIMER_STRATEGIES)[number];

export interface ClockTick {
  index: number;
  scheduledNs: bigint;
  actualNs: bigint;
  jitterMs: number;
}

export interface ClockOptions {
  tickHz: number;
  spinWindowMs?: number;
  nowNs?: () => bigint;
  onTick: (tick: ClockTick) => void;
  /** Auto-stop after this many fired ticks. Used by tests and the harness. */
  ticks?: number;
}

export interface ClockHandle {
  readonly strategy: TimerStrategy;
  readonly nominalNs: bigint;
  stop(): void;
}

export interface JitterSummary {
  count: number;
  p50Ms: number;
  p99Ms: number;
  maxMs: number;
}

/** Quantile summary over jitter samples. Same nearest-rank pick as getMetrics. */
export function summarizeJitter(samplesMs: readonly number[]): JitterSummary {
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const count = sorted.length;
  if (count === 0) return { count: 0, p50Ms: 0, p99Ms: 0, maxMs: 0 };
  const p50Index = Math.min(count - 1, Math.max(0, Math.floor(0.5 * (count - 1))));
  const p99Index = Math.min(count - 1, Math.max(0, Math.floor(0.99 * (count - 1))));
  return {
    count,
    p50Ms: sorted[p50Index] ?? 0,
    p99Ms: sorted[p99Index] ?? 0,
    maxMs: sorted[count - 1] ?? 0,
  };
}

export function startClock(strategy: TimerStrategy, options: ClockOptions): ClockHandle {
  if (!(TIMER_STRATEGIES as readonly string[]).includes(strategy)) {
    throw new Error(`unknown timer strategy: ${String(strategy)}`);
  }
  const tickHz = options.tickHz;
  if (!Number.isFinite(tickHz) || tickHz <= 0) {
    throw new Error(`tickHz must be a positive number, got ${String(tickHz)}`);
  }
  const now = options.nowNs ?? process.hrtime.bigint;
  const rawSpin = options.spinWindowMs ?? 1.5;
  const spinMs = Number.isNaN(rawSpin) ? 1.5 : Math.min(5, Math.max(0, rawSpin));
  const nominalNs = BigInt(Math.round(1e9 / tickHz));
  const startNs = now();
  const maxTicks = options.ticks;

  let running = true;
  let fired = 0;
  let timer: NodeJS.Timeout | null = null;
  let immediate: NodeJS.Immediate | null = null;
  let coarseOk: boolean | null = null;
  const cell = new Int32Array(new SharedArrayBuffer(4));

  const stop = (): void => {
    running = false;
    if (timer !== null) {
      clearInterval(timer);
      clearTimeout(timer);
      timer = null;
    }
    if (immediate !== null) {
      clearImmediate(immediate);
      immediate = null;
    }
    try {
      Atomics.notify(cell, 0, 1);
    } catch {
      // Notify is best effort; the running flag alone still stops the loop.
    }
  };

  // Shared by all three strategy closures so tick numbering and jitter math
  // stay in lockstep no matter which wait mechanism fires.
  const fire = (index: number): void => {
    const scheduledNs = startNs + nominalNs * BigInt(index);
    const actualNs = now();
    const jitterMs = actualNs <= scheduledNs ? 0 : Number(actualNs - scheduledNs) / 1e6;
    fired += 1;
    options.onTick({ index, scheduledNs, actualNs, jitterMs });
    if (maxTicks !== undefined && fired >= maxTicks) stop();
  };

  if (strategy === "interval") {
    // Tick 0 is scheduled at startNs itself: fire it immediately so all
    // three strategies produce [0..N) with identical numbering. The interval
    // then covers tick 1 onward; drift correction never skips tick 0.
    fire(0);
    let next = 1;
    timer = setInterval(() => {
      if (!running) return;
      const actual = now();
      // Drift correction: re-anchor to start and skip ticks the loop missed.
      const behind = actual <= startNs ? 0 : Math.floor(Number(actual - startNs) / Number(nominalNs));
      if (behind > next) next = behind;
      fire(next);
      next += 1;
    }, 1000 / tickHz);
  } else if (strategy === "timeout-spin") {
    const arm = (index: number): void => {
      if (!running) return;
      if (maxTicks !== undefined && index >= maxTicks) {
        stop();
        return;
      }
      const expected = startNs + nominalNs * BigInt(index);
      const delayMs = Number(expected - now()) / 1e6 - spinMs;
      timer = setTimeout(() => {
        while (running && now() < expected) {
          // Busy-wait tail: trade CPU for sub-millisecond phase accuracy.
        }
        if (!running) return;
        fire(index);
        arm(index + 1);
      }, Math.max(0, delayMs));
    };
    arm(0);
  } else {
    const step = (index: number): void => {
      if (!running) return;
      if (maxTicks !== undefined && index >= maxTicks) {
        stop();
        return;
      }
      const expected = startNs + nominalNs * BigInt(index);
      const coarseMs = Number(expected - now()) / 1e6 - spinMs;
      if (coarseMs > 0) {
        if (coarseOk === null) {
          try {
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 0);
            coarseOk = true;
          } catch {
            coarseOk = false;
          }
        }
        if (!coarseOk) {
          // Thread forbids Atomics.wait: same shape as timeout-spin.
          timer = setTimeout(() => {
            if (!running) return;
            fire(index);
            immediate = setImmediate(() => step(index + 1));
          }, coarseMs);
          return;
        }
        Atomics.wait(cell, 0, 0, Math.ceil(coarseMs));
      }
      while (running && now() < expected) {
        // Spin tail over the last spinWindowMs.
      }
      if (!running) return;
      fire(index);
      immediate = setImmediate(() => step(index + 1));
    };
    immediate = setImmediate(() => step(0));
  }

  return { strategy, nominalNs, stop };
}
