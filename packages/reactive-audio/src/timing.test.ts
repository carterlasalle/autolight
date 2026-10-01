// T-AUD-04 audio timing alignment: the capture path latency is measured and
// recorded, and every feature is timestamped in show clock time through that
// offset. The aligned-feature test uses a synthetic delay and a DSP onset.

import { describe, expect, it } from "vitest";
import { LiveFeatureExtractor } from "./dsp.js";
import { LatencyCalibration, alignFeature, alignedShowTimeNs, measureLatency } from "./timing.js";

describe("audio timing alignment (T-AUD-04)", () => {
  it("measures the capture path latency from an emitted click", () => {
    const measurement = measureLatency({ emittedAtMs: 0, detectedAtMs: 120 });
    expect(measurement).toEqual({ latencyMs: 120, confidence: 1, method: "impulse" });
    const smeared = measureLatency({ emittedAtMs: 100, detectedAtMs: 200, spreadMs: 25 });
    expect(smeared.latencyMs).toBe(100);
    expect(smeared.confidence).toBeCloseTo(0.75, 9);
    const reference = measureLatency({ emittedAtMs: 0, detectedAtMs: 40, method: "reference-onset" });
    expect(reference.method).toBe("reference-onset");
  });

  it("aligns a synthetic delayed feature back to show time", () => {
    const latencyMs = 120;
    const captureNs = BigInt(Math.round((1000 + latencyMs) * 1e6));
    expect(alignedShowTimeNs(captureNs, latencyMs)).toBe(1_000_000_000n);
    const feature = alignFeature({ captureTimeNs: captureNs, onset: true }, latencyMs);
    expect(feature.showTimeNs).toBe(1_000_000_000n);
    expect(feature.onset).toBe(true);
  });

  it("never presents an uncalibrated path as aligned", () => {
    const calibration = new LatencyCalibration();
    expect(calibration.measured).toBe(false);
    expect(calibration.offsetMs).toBeNull();
    const captureNs = 5_000_000_000n;
    expect(calibration.align(captureNs)).toEqual({ showTimeNs: captureNs, measured: false });
    calibration.record(measureLatency({ emittedAtMs: 0, detectedAtMs: 120 }));
    expect(calibration.measured).toBe(true);
    expect(calibration.offsetMs).toBe(120);
    expect(calibration.align(captureNs)).toEqual({ showTimeNs: 4_880_000_000n, measured: true });
  });

  it("aligns a DSP onset to the music inside one hop", () => {
    const sampleRate = 48_000;
    const hop = 512;
    const latencyMs = 120;
    const extractor = new LiveFeatureExtractor({ sampleRate, fftSize: 2048, hopSize: hop });
    // The music click is at show time 1,000 ms; the capture path delays it by
    // the measured latency, so it enters the capture stream 120 ms later.
    const captureSample = Math.round(((1000 + latencyMs) / 1000) * sampleRate);
    const total = captureSample + 4 * hop;
    const signal = new Float64Array(total);
    signal[captureSample] = 1;
    let onsetHop: number | null = null;
    for (let offset = 0; offset + hop <= total; offset += hop) {
      const features = extractor.push(signal.subarray(offset, offset + hop));
      if (features.onset && onsetHop === null) onsetHop = offset / hop;
    }
    expect(onsetHop).not.toBeNull();
    const captureWindowEndMs = (((onsetHop! + 1) * hop) / sampleRate) * 1000;
    const alignedMs = captureWindowEndMs - latencyMs;
    const hopMs = (hop / sampleRate) * 1000;
    expect(Math.abs(alignedMs - 1000)).toBeLessThanOrEqual(hopMs + 1e-9);
  });
});
