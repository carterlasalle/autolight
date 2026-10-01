import { describe, expect, it } from "vitest";
import { BeatEstimator, ESTIMATOR_DEFAULTS, QUALITY_WEIGHT, type ObservationQuality } from "@autolight/dj-core";

// P-57-estimator: noisy 30 Hz observations with jitter and loss give a beat
// trace with error below runtime.estimator.maxErrorMs (20 ms) and zero
// backward steps while playing; pitch changes of plus or minus 8 and 16
// percent are tracked within the bound (T-RUN-02, spec 57).

const TICK_HZ = 30;
const BPM = 120;
const BEATS_PER_SECOND = BPM / 60;
const NS_PER_SECOND = 1e9;
const MAX_ERROR_MS = 20;

// Deterministic pseudo-random source: the test never depends on Math.random.
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

interface Sample {
  nowNs: bigint;
  observedBeat: number;
  lost: boolean;
}

function trace(opts: {
  seed: number;
  seconds: number;
  jitterMs: number;
  pitch: (t: number) => number;
  lossEvery: number;
}): Sample[] {
  const rand = lcg(opts.seed);
  const samples: Sample[] = [];
  const frames = Math.round(opts.seconds * TICK_HZ);
  let trueSeconds = 0;
  for (let i = 0; i < frames; i += 1) {
    trueSeconds += (1 / TICK_HZ) * opts.pitch(i / TICK_HZ);
    const jitter = (rand() * 2 - 1) * (opts.jitterMs / 1000);
    samples.push({
      nowNs: BigInt(Math.round((i / TICK_HZ) * NS_PER_SECOND)),
      observedBeat: (trueSeconds + jitter) * BEATS_PER_SECOND,
      lost: opts.lossEvery > 0 && i % opts.lossEvery === opts.lossEvery - 1,
    });
  }
  return samples;
}

interface Run {
  errorsMs: number[];
  corrected: number[];
  beats: number[];
  backward: number;
  seeks: number;
}

function run(
  samples: Sample[],
  opts: { quality?: ObservationQuality; rate?: (nowNs: bigint) => number } = {},
): Run {
  const estimator = new BeatEstimator(0, ESTIMATOR_DEFAULTS);
  const quality = opts.quality ?? "exact";
  const errorsMs: number[] = [];
  const corrected: number[] = [];
  const beats: number[] = [];
  let backward = 0;
  let seeks = 0;
  let previous: number | null = null;
  for (const sample of samples) {
    if (sample.lost) continue; // observation lost: the estimator extrapolates
    const result = estimator.observe({
      beat: sample.observedBeat,
      nowNs: sample.nowNs,
      quality,
      playing: true,
      beatsPerSecond: opts.rate?.(sample.nowNs) ?? BEATS_PER_SECOND,
    });
    if (result.seeked) seeks += 1;
    else errorsMs.push(result.errorMs);
    corrected.push(result.corrected);
    if (previous !== null && result.beat < previous - 1e-9) backward += 1;
    previous = result.beat;
    beats.push(result.beat);
  }
  return { errorsMs, corrected, beats, backward, seeks };
}

describe("estimator (P-57)", () => {
  it("keeps jitter and loss inside the error bound with zero backward steps", () => {
    const samples = trace({ seed: 7, seconds: 10, jitterMs: 10, pitch: () => 1, lossEvery: 7 });
    const result = run(samples);
    const settled = result.errorsMs.slice(30);
    expect(result.seeks).toBe(0);
    expect(Math.max(...settled)).toBeLessThan(MAX_ERROR_MS);
    expect(result.backward).toBe(0);
  });

  it("tracks pitch changes of plus or minus 8 and 16 percent", () => {
    for (const pitch of [1.08, 0.92, 1.16, 0.84]) {
      const samples = trace({
        seed: 11 + Math.round(pitch * 100),
        seconds: 12,
        jitterMs: 8,
        pitch: (t) => (t < 4 ? 1 : pitch),
        lossEvery: 11,
      });
      const changeNs = 4n * BigInt(NS_PER_SECOND);
      const result = run(samples, {
        rate: (nowNs) => (nowNs < changeNs ? BEATS_PER_SECOND : BEATS_PER_SECOND * pitch),
      });
      expect(result.seeks, `pitch ${pitch}`).toBe(0);
      expect(Math.max(...result.errorsMs.slice(-120)), `pitch ${pitch}`).toBeLessThan(MAX_ERROR_MS);
      expect(result.backward, `pitch ${pitch}`).toBe(0);
    }
  });

  it("weights the correction by observation quality", () => {
    // A 5 ms phase step at frame 15: the same error, corrected by both
    // qualities, and the exact time corrects twice as fast.
    const samples = trace({ seed: 23, seconds: 2, jitterMs: 0, pitch: () => 1, lossEvery: 0 });
    const stepAt = 15;
    const stepBeat = 0.01;
    const stepped = samples.map((sample, i) =>
      i >= stepAt ? { ...sample, observedBeat: sample.observedBeat + stepBeat } : sample,
    );
    const exact = run(stepped, { quality: "exact" });
    const estimated = run(stepped, { quality: "estimated" });
    expect(exact.seeks).toBe(0);
    expect(estimated.seeks).toBe(0);
    expect(QUALITY_WEIGHT.exact).toBeGreaterThan(QUALITY_WEIGHT.estimated);
    expect(exact.corrected[stepAt]!).toBeGreaterThan(0);
    expect(exact.corrected[stepAt]!).toBeCloseTo(estimated.corrected[stepAt]! * 2, 3);
    expect(exact.errorsMs[stepAt + 2]!).toBeLessThan(estimated.errorsMs[stepAt + 2]!);
    expect(Math.max(...estimated.errorsMs.slice(-20))).toBeLessThan(MAX_ERROR_MS);
  });

  it("turns a large error into a transport event, not a correction", () => {
    const estimator = new BeatEstimator(0, ESTIMATOR_DEFAULTS);
    estimator.observe({ beat: 0, nowNs: 0n, quality: "exact", playing: true, beatsPerSecond: BEATS_PER_SECOND });
    // Hot cue from beat 0 to beat 300 (spec 58 example): a seek, not a slew.
    const seek = estimator.observe({
      beat: 300,
      nowNs: BigInt(NS_PER_SECOND),
      quality: "exact",
      playing: true,
      beatsPerSecond: BEATS_PER_SECOND,
    });
    expect(seek.seeked).toBe(true);
    expect(seek.beat).toBe(300);
    // 150 ms of error at 2 beats/s (0.3 beats) stays a smooth correction.
    estimator.reset(0, 0n);
    const small = estimator.observe({
      beat: 0.3,
      nowNs: BigInt(Math.round(NS_PER_SECOND / 30)),
      quality: "exact",
      playing: true,
      beatsPerSecond: BEATS_PER_SECOND,
    });
    expect(small.seeked).toBe(false);
    expect(small.corrected).toBeGreaterThan(0);
  });

  it("holds a paused deck and corrects it in place", () => {
    const estimator = new BeatEstimator(64, ESTIMATOR_DEFAULTS);
    const paused = { quality: "exact" as const, playing: false, beatsPerSecond: BEATS_PER_SECOND };
    expect(estimator.observe({ beat: 64, nowNs: 0n, ...paused }).beat).toBe(64);
    estimator.observe({ beat: 64, nowNs: 30_000_000n, ...paused });
    const nudged = estimator.observe({ beat: 64.2, nowNs: 60_000_000n, ...paused });
    expect(nudged.beat).toBeGreaterThan(64);
    expect(nudged.beat).toBeLessThanOrEqual(64.2);
  });
});
