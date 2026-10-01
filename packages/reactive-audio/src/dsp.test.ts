// T-AUD-02 independent DSP: synthetic-signal tests (spec 68). Sine tones and
// sweeps land in the right band; a click and a noise burst fire the onset
// detector inside one hop; AGC converges; a click train yields the tempo used
// by the adaptive clock (DS-23).

import { describe, expect, it } from "vitest";
import {
  AGC_DEFAULTS,
  Fft,
  FrameAgc,
  LiveFeatureExtractor,
  OnsetDetector,
  bandEnergies,
  hzToMel,
  melEnergies,
  melFilterbank,
  spectralDifference,
  spectralFlux,
  tempoFromOnsets,
} from "./dsp.js";

const SAMPLE_RATE = 8192;
const FFT_SIZE = 2048;

function sine(freq: number, seconds: number, sampleRate = SAMPLE_RATE, amp = 0.5): Float64Array {
  const length = Math.round(seconds * sampleRate);
  const out = new Float64Array(length);
  for (let i = 0; i < length; i += 1) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  return out;
}

function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function argMax(values: Float64Array): number {
  let best = 0;
  for (let i = 1; i < values.length; i += 1) if (values[i]! > values[best]!) best = i;
  return best;
}

function powerOf(frame: Float64Array): Float64Array {
  return new Fft(frame.length).power(frame);
}

describe("dsp (T-AUD-02)", () => {
  it("puts a bin-aligned sine in its bin", () => {
    const fft = new Fft(64);
    const frame = new Float64Array(64);
    for (let i = 0; i < 64; i += 1) frame[i] = Math.sin((2 * Math.PI * 5 * i) / 64);
    const power = fft.power(frame);
    expect(argMax(power)).toBe(5);
    expect(power[5]!).toBeGreaterThan(power[4]! * 3);
    expect(power[5]!).toBeGreaterThan(power[6]! * 3);
    expect(power[5]!).toBeGreaterThan(power[20]! * 1000);
    expect(() => fft.power(new Float64Array(32))).toThrow(/expected 64/);
  });

  it("builds one triangular filter per mel band", () => {
    const filters = melFilterbank({ sampleRate: SAMPLE_RATE, fftSize: FFT_SIZE, bands: 24 });
    expect(filters).toHaveLength(24);
    for (const filter of filters) {
      expect(filter).toHaveLength(FFT_SIZE / 2 + 1);
      expect(filter.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    }
    expect(hzToMel(1000)).toBeGreaterThan(hzToMel(500));
  });

  it("puts sine energy in the right live band and mel band", () => {
    const mixAt = (hz: number) => {
      const power = powerOf(sine(hz, FFT_SIZE / SAMPLE_RATE));
      const bands = bandEnergies(power, SAMPLE_RATE, FFT_SIZE);
      const total = bands[0] + bands[1] + bands[2] + bands[3];
      return { power, mix: [bands[0] / total, bands[1] / total, bands[2] / total, bands[3] / total] };
    };
    const bass = mixAt(100);
    expect(bass.mix[0]!).toBeGreaterThan(0.9);
    const mid = mixAt(1000);
    expect(mid.mix[2]!).toBeGreaterThan(0.9);
    const high = mixAt(3000);
    expect(high.mix[3]!).toBeGreaterThan(0.9);
    const filters = melFilterbank({ sampleRate: SAMPLE_RATE, fftSize: FFT_SIZE, bands: 24 });
    expect(argMax(melEnergies(bass.power, filters))).toBeLessThan(argMax(melEnergies(mid.power, filters)));
  });

  it("tracks a sine sweep across the bands", () => {
    const extractor = new LiveFeatureExtractor({ sampleRate: SAMPLE_RATE, fftSize: FFT_SIZE, hopSize: FFT_SIZE });
    const seconds = 2;
    const signal = new Float64Array(seconds * SAMPLE_RATE);
    for (let i = 0; i < signal.length; i += 1) {
      const t = i / SAMPLE_RATE;
      const freq = 100 + (2900 * t) / seconds;
      signal[i] = 0.5 * Math.sin(2 * Math.PI * freq * t);
    }
    const first = extractor.push(signal.subarray(0, FFT_SIZE));
    const last = extractor.push(signal.subarray(signal.length - FFT_SIZE));
    // The sweep starts near 100 Hz (bass and low-mid) and ends near 3 kHz (high).
    expect(first.bandMix[0]! + first.bandMix[1]!).toBeGreaterThan(0.8);
    expect(first.bandMix[3]!).toBeLessThan(0.05);
    expect(last.bandMix[3]!).toBeGreaterThan(0.9);
    expect(last.bandMix[0]!).toBeLessThan(first.bandMix[0]!);
  });

  it("rectifies the spectral difference for flux", () => {
    const previous = Float64Array.from([1, 2, 3]);
    const current = Float64Array.from([1, 4, 2]);
    expect(spectralDifference(previous, current)).toBe(1);
    expect(spectralFlux(previous, current)).toBe(2);
    expect(spectralFlux(current, current)).toBe(0);
    expect(() => spectralFlux(previous, Float64Array.from([1, 2]))).toThrow(/differ in length/);
  });

  it("detects clicks within one hop", () => {
    const sampleRate = 48_000;
    const hop = 512;
    const extractor = new LiveFeatureExtractor({ sampleRate, fftSize: 2048, hopSize: hop });
    const total = 30_000;
    const signal = new Float64Array(total);
    const clicks = [5_000, 15_000, 25_000];
    for (const at of clicks) signal[at] = 1;
    const onsets: number[] = [];
    for (let offset = 0; offset + hop <= total; offset += hop) {
      const features = extractor.push(signal.subarray(offset, offset + hop));
      if (features.onset) onsets.push(offset / hop);
    }
    expect(onsets).toHaveLength(clicks.length);
    for (let i = 0; i < clicks.length; i += 1) {
      expect(Math.abs(onsets[i]! - Math.floor(clicks[i]! / hop))).toBeLessThanOrEqual(1);
    }
  });

  it("fires on a noise burst after silence", () => {
    const fft = new Fft(1024);
    const detector = new OnsetDetector({ threshold: 1.5 });
    const rand = lcg(11);
    for (let i = 0; i < 10; i += 1) detector.push(fft.power(new Float64Array(1024)));
    const burst = new Float64Array(1024);
    for (let i = 0; i < burst.length; i += 1) burst[i] = rand() * 2 - 1;
    const result = detector.push(fft.power(burst));
    expect(result.flux).toBeGreaterThan(0);
    expect(result.onset).toBe(true);
  });

  it("stays quiet on a steady tone once the history is warm", () => {
    const hop = FFT_SIZE;
    const extractor = new LiveFeatureExtractor({ sampleRate: SAMPLE_RATE, fftSize: FFT_SIZE, hopSize: hop });
    // 1000 Hz at 8192 Hz is frame-aligned, so consecutive frames are identical.
    const tone = sine(1000, 2);
    let onsets = 0;
    for (let offset = 0; offset + hop <= tone.length; offset += hop) {
      const features = extractor.push(tone.subarray(offset, offset + hop));
      if (offset >= 60 * hop && features.onset) onsets += 1;
    }
    expect(onsets).toBe(0);
  });

  it("converges the AGC gain and clamps at the range edges", () => {
    const agc = new FrameAgc();
    const loud = new Float64Array(2048).fill(0.2);
    let state = { gain: 1, envelope: 0 };
    for (let i = 0; i < 4000; i += 1) state = agc.process(loud);
    expect(state.gain * 0.2).toBeCloseTo(AGC_DEFAULTS.target, 2);
    expect(state.envelope).toBeCloseTo(0.2, 6);
    const quiet = new Float64Array(2048).fill(0.05);
    for (let i = 0; i < 4000; i += 1) state = agc.process(quiet);
    expect(state.gain).toBe(4);
  });

  it("estimates the tempo of a click train", () => {
    const hopSeconds = 512 / 48_000;
    const fast = new Array<number>(512).fill(0);
    for (let i = 0; i < 512; i += 47) fast[i] = 1;
    const fastEstimate = tempoFromOnsets(fast, hopSeconds)!;
    expect(fastEstimate.bpm).toBeGreaterThan(117);
    expect(fastEstimate.bpm).toBeLessThan(123);
    expect(fastEstimate.confidence).toBeGreaterThan(0.5);
    const slow = new Array<number>(512).fill(0);
    for (let i = 0; i < 512; i += 93) slow[i] = 1;
    const slowEstimate = tempoFromOnsets(slow, hopSeconds)!;
    expect(slowEstimate.bpm).toBeGreaterThan(57);
    expect(slowEstimate.bpm).toBeLessThan(63);
    expect(tempoFromOnsets([1, 0, 1], hopSeconds)).toBeNull();
  });

  it("estimates 120 BPM from a click train through the extractor", () => {
    const sampleRate = 48_000;
    const hop = 512;
    const extractor = new LiveFeatureExtractor({ sampleRate, fftSize: 2048, hopSize: hop });
    const signal = new Float64Array(4 * sampleRate);
    for (let at = 0; at < signal.length; at += 24_000) signal[at] = 1;
    let features = extractor.push(signal.subarray(0, hop));
    for (let offset = hop; offset + hop <= signal.length; offset += hop) {
      features = extractor.push(signal.subarray(offset, offset + hop));
    }
    expect(features.tempo).not.toBeNull();
    expect(features.tempo!.bpm).toBeGreaterThan(117);
    expect(features.tempo!.bpm).toBeLessThan(123);
  });
});
