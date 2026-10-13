// T-AUD-04 audio timing alignment. The capture path (output to feature) has a
// measurable latency; every feature is timestamped in show clock time with
// that offset, so the composite provider's correlation (T-LIVE-07) and the
// adaptive clock (DS-23) use aligned data instead of raw capture time.
//
// The procedure: play a test click (or a reference track with a known onset)
// through the chosen output, capture it, and measure the time from emission
// to the detected onset. The measurement is recorded (qualification) and the
// offset is applied here.

export interface LatencyMeasurement {
  /** Output-to-detection latency in milliseconds. */
  latencyMs: number;
  /** 0 to 1; lower when the detected onset was smeared over `spreadMs`. */
  confidence: number;
  method: "impulse" | "reference-onset";
}

export function measureLatency(opts: {
  emittedAtMs: number;
  detectedAtMs: number;
  spreadMs?: number;
  method?: LatencyMeasurement["method"];
}): LatencyMeasurement {
  // Emitted before detected: inverted ordering or clock-domain skew is a
  // wiring fault, never a zero-latency measurement. Surface it so callers
  // cannot mistake it for a good calibration.
  if (!Number.isFinite(opts.detectedAtMs) || !Number.isFinite(opts.emittedAtMs)) {
    throw new RangeError(`measureLatency: non-finite clock readings (emitted=${opts.emittedAtMs}, detected=${opts.detectedAtMs})`);
  }

  if (opts.detectedAtMs < opts.emittedAtMs) {
    throw new RangeError(`measureLatency: detectedAtMs (${opts.detectedAtMs}) precedes emittedAtMs (${opts.emittedAtMs})`);
  }

  const latencyMs = opts.detectedAtMs - opts.emittedAtMs;
  const spreadMs = opts.spreadMs ?? 0;
  const confidence = spreadMs <= 0 ? 1 : Math.max(0, 1 - spreadMs / Math.max(1, latencyMs));

  return { latencyMs, confidence, method: opts.method ?? "impulse" };
}

/**
 * A feature that the capture path detected at `captureTimeNs` describes the
 * music at this show clock time: the capture latency is subtracted, never
 * added.
 */
export function alignedShowTimeNs(captureTimeNs: bigint, latencyMs: number): bigint {
  if (!Number.isFinite(latencyMs) || latencyMs < 0) {
    throw new RangeError(`alignedShowTimeNs: invalid latencyMs ${latencyMs}`);
  }

  const offsetNs = BigInt(Math.round(latencyMs * 1e6));

  return captureTimeNs > offsetNs ? captureTimeNs - offsetNs : 0n;
}

export function alignFeature<F extends { captureTimeNs: bigint }>(
  feature: F,
  latencyMs: number,
): F & { showTimeNs: bigint } {
  return { ...feature, showTimeNs: alignedShowTimeNs(feature.captureTimeNs, latencyMs) };
}

/**
 * Holds the recorded offset. Until a measurement exists the offset is
 * unknown: alignment returns the capture time unchanged and `measured` is
 * false, so an uncalibrated path is never presented as aligned.
 */
export class LatencyCalibration {
  private measurement: LatencyMeasurement | null = null;

  get measured(): boolean {
    return this.measurement !== null;
  }

  get offsetMs(): number | null {
    return this.measurement?.latencyMs ?? null;
  }

  record(measurement: LatencyMeasurement): void {
    if (!Number.isFinite(measurement.latencyMs) || measurement.latencyMs < 0) {
      throw new RangeError(`LatencyCalibration.record: invalid latencyMs ${measurement.latencyMs}`);
    }

    if (!Number.isFinite(measurement.confidence) || measurement.confidence < 0 || measurement.confidence > 1) {
      throw new RangeError(`LatencyCalibration.record: invalid confidence ${measurement.confidence}`);
    }

    this.measurement = measurement;
  }

  align(captureTimeNs: bigint): { showTimeNs: bigint; measured: boolean } {
    if (this.measurement === null) return { showTimeNs: captureTimeNs, measured: false };

    return { showTimeNs: alignedShowTimeNs(captureTimeNs, this.measurement.latencyMs), measured: true };
  }
}
