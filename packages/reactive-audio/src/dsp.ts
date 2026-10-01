// Live audio DSP (T-AUD-02, spec 68). Independent implementation written from
// the concepts: radix-2 FFT with Hann windowing, mel filter banks, band
// energies, half-wave spectral flux with an adaptive (z-score) onset
// threshold, AGC with rise/decay smoothing, and an autocorrelation tempo
// estimate for the adaptive fallback clock (DS-23). No third-party DSP code.
//
// The constants below mirror the `audio.*` registry keys (`audio.fftSize`
// 2048, `audio.melBands` 24, `audio.agc.*`, `audio.onset.threshold` 1.5,
// `analysis.frame.hop` 512); callers pass the resolved configuration, these
// are the fallbacks.

export const DEFAULT_FFT_SIZE = 2048;
export const DEFAULT_MEL_BANDS = 24;
export const DEFAULT_ONSET_THRESHOLD = 1.5;
export const DEFAULT_HOP_SIZE = 512;

export interface AgcState {
  gain: number;
  smoothed: number;
}

/** audio.agc.* defaults. */
export const AGC_DEFAULTS = { rise: 0.3, decay: 0.05, target: 0.5 } as const;

// AGC step: the envelope rises fast and decays slowly toward the input, and
// the gain moves toward the level that would put the input at the target.
// The gain is clamped to a sane range so silence cannot run it away.
export function agcStep(
  prev: AgcState,
  input: number,
  opts: { rise?: number; decay?: number; target?: number } = {},
): AgcState {
  const rise = opts.rise ?? AGC_DEFAULTS.rise;
  const decay = opts.decay ?? AGC_DEFAULTS.decay;
  const target = opts.target ?? AGC_DEFAULTS.target;
  const gain = prev.gain + (target - Math.min(1, input * prev.gain)) * 0.01;
  const smoothed = input > prev.smoothed
    ? prev.smoothed + (input - prev.smoothed) * rise
    : prev.smoothed + (input - prev.smoothed) * decay;
  return { gain: Math.min(4, Math.max(0.25, gain)), smoothed };
}

export function hannWindow(size: number): Float64Array {
  const window = new Float64Array(size);
  for (let i = 0; i < size; i += 1) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
  return window;
}

// In-place iterative radix-2 FFT (Cooley-Tukey), forward transform. The
// inputs are the real and imaginary parts; both must be the same power-of-two
// length. Written from the standard decomposition, no external DSP code.
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if (n !== im.length || n < 2 || (n & (n - 1)) !== 0) {
    throw new Error(`fft needs two equal power-of-two arrays, got ${n} and ${im.length}`);
  }
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; (j & bit) !== 0; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]!;
      re[i] = re[j]!;
      re[j] = tr;
      const ti = im[i]!;
      im[i] = im[j]!;
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const angle = (-2 * Math.PI) / len;
    const wRe = Math.cos(angle);
    const wIm = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < half; k += 1) {
        const evenRe = re[i + k]!;
        const evenIm = im[i + k]!;
        const oddRe = re[i + k + half]! * curRe - im[i + k + half]! * curIm;
        const oddIm = re[i + k + half]! * curIm + im[i + k + half]! * curRe;
        re[i + k] = evenRe + oddRe;
        im[i + k] = evenIm + oddIm;
        re[i + k + half] = evenRe - oddRe;
        im[i + k + half] = evenIm - oddIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

export class Fft {
  readonly size: number;
  private readonly window: Float64Array;
  private readonly re: Float64Array;
  private readonly im: Float64Array;

  constructor(size: number = DEFAULT_FFT_SIZE, window?: Float64Array) {
    if (size < 2 || (size & (size - 1)) !== 0) {
      throw new Error(`fft size must be a power of two, got ${size}`);
    }
    if (window !== undefined && window.length !== size) {
      throw new Error(`fft window is ${window.length} long, expected ${size}`);
    }
    this.size = size;
    this.window = window ?? hannWindow(size);
    this.re = new Float64Array(size);
    this.im = new Float64Array(size);
  }

  /** Windowed power spectrum; one value per bin, bin count is size / 2 + 1. */
  power(samples: Float64Array): Float64Array {
    if (samples.length !== this.size) {
      throw new Error(`fft frame is ${samples.length} long, expected ${this.size}`);
    }
    for (let i = 0; i < this.size; i += 1) {
      this.re[i] = samples[i]! * this.window[i]!;
      this.im[i] = 0;
    }
    fft(this.re, this.im);
    const bins = this.size / 2 + 1;
    const out = new Float64Array(bins);
    for (let k = 0; k < bins; k += 1) out[k] = this.re[k]! * this.re[k]! + this.im[k]! * this.im[k]!;
    return out;
  }
}

export function hzToMel(hz: number): number {
  return 2595 * Math.log10(1 + hz / 700);
}

export function melToHz(mel: number): number {
  return 700 * (10 ** (mel / 2595) - 1);
}

// Triangular mel filters over the FFT bins (HTK mel scale).
export function melFilterbank(opts: {
  sampleRate: number;
  fftSize: number;
  bands?: number;
  fMin?: number;
  fMax?: number;
}): Float64Array[] {
  const bands = opts.bands ?? DEFAULT_MEL_BANDS;
  const fMin = opts.fMin ?? 20;
  const fMax = opts.fMax ?? Math.min(20000, opts.sampleRate / 2);
  const bins = opts.fftSize / 2 + 1;
  const binHz = opts.sampleRate / opts.fftSize;
  const melMin = hzToMel(fMin);
  const melMax = hzToMel(fMax);
  const centres = Array.from({ length: bands + 2 }, (_, i) => melToHz(melMin + ((melMax - melMin) * i) / (bands + 1)));
  return Array.from({ length: bands }, (_, b) => {
    const filter = new Float64Array(bins);
    const lo = centres[b]!;
    const mid = centres[b + 1]!;
    const hi = centres[b + 2]!;
    for (let k = 0; k < bins; k += 1) {
      const hz = k * binHz;
      if (hz >= lo && hz <= mid && mid > lo) filter[k] = (hz - lo) / (mid - lo);
      else if (hz > mid && hz <= hi && hi > mid) filter[k] = (hi - hz) / (hi - mid);
    }
    return filter;
  });
}

/** Mel band energies: the filter-weighted sum of the power spectrum per band. */
export function melEnergies(power: Float64Array, filters: readonly Float64Array[]): Float64Array {
  const out = new Float64Array(filters.length);
  for (let b = 0; b < filters.length; b += 1) {
    const filter = filters[b]!;
    let sum = 0;
    const bins = Math.min(filter.length, power.length);
    for (let k = 0; k < bins; k += 1) sum += filter[k]! * power[k]!;
    out[b] = sum;
  }
  return out;
}

export type LiveBand = "bass" | "lowMid" | "mid" | "high";

export const LIVE_BAND_ORDER: readonly LiveBand[] = ["bass", "lowMid", "mid", "high"];

export const LIVE_BANDS: Record<LiveBand, readonly [number, number]> = {
  bass: [20, 150],
  lowMid: [150, 500],
  mid: [500, 2000],
  high: [2000, 20000],
};

/** Mean power in each live band, in LIVE_BAND_ORDER. */
export function bandEnergies(
  power: Float64Array,
  sampleRate: number,
  fftSize: number,
  bands: Record<LiveBand, readonly [number, number]> = LIVE_BANDS,
): [number, number, number, number] {
  const binHz = sampleRate / fftSize;
  const bins = power.length;
  return LIVE_BAND_ORDER.map((band) => {
    const [lo, hi] = bands[band];
    const first = Math.max(0, Math.floor(lo / binHz));
    const last = Math.min(bins - 1, Math.ceil(hi / binHz) - 1);
    if (last < first) return 0;
    let sum = 0;
    for (let k = first; k <= last; k += 1) sum += power[k]!;
    return sum / (last - first + 1);
  }) as [number, number, number, number];
}

/** Signed spectral difference: the summed change per bin. */
export function spectralDifference(previous: Float64Array, current: Float64Array): number {
  if (previous.length !== current.length) {
    throw new Error(`spectra differ in length: ${previous.length} and ${current.length}`);
  }
  let sum = 0;
  for (let k = 0; k < current.length; k += 1) sum += current[k]! - previous[k]!;
  return sum;
}

/** Spectral flux: the half-wave rectified spectral difference (onsets only). */
export function spectralFlux(previous: Float64Array, current: Float64Array): number {
  if (previous.length !== current.length) {
    throw new Error(`spectra differ in length: ${previous.length} and ${current.length}`);
  }
  let sum = 0;
  for (let k = 0; k < current.length; k += 1) {
    const diff = current[k]! - previous[k]!;
    if (diff > 0) sum += diff;
  }
  return sum;
}

export interface OnsetResult {
  flux: number;
  /** Adaptive threshold score: flux against the recent flux statistics. */
  z: number;
  onset: boolean;
}

// Onset detection: spectral flux against an adaptive (z-score) threshold
// (audio.onset.threshold). The threshold adapts to the recent flux history so
// a quiet passage and a loud one both fire on real attacks. Overlapping hops
// keep one attack inside the window for fftSize / hopSize frames, so a
// refractory period collapses those repeats into one onset.
export class OnsetDetector {
  private previous: Float64Array | null = null;
  private readonly history: number[] = [];
  private readonly threshold: number;
  private readonly window: number;
  private readonly refractory: number;
  private framesSinceOnset = Number.POSITIVE_INFINITY;

  constructor(opts: { threshold?: number; window?: number; refractoryFrames?: number } = {}) {
    this.threshold = opts.threshold ?? DEFAULT_ONSET_THRESHOLD;
    this.window = opts.window ?? 43;
    this.refractory = Math.max(1, opts.refractoryFrames ?? 1);
  }

  push(power: Float64Array): OnsetResult {
    const flux = this.previous === null ? 0 : spectralFlux(this.previous, power);
    this.previous = Float64Array.from(power);
    this.framesSinceOnset += 1;
    let z = 0;
    if (this.history.length >= 4) {
      let mean = 0;
      for (const value of this.history) mean += value;
      mean /= this.history.length;
      let variance = 0;
      for (const value of this.history) variance += (value - mean) ** 2;
      variance /= this.history.length;
      // The denominator is floored so a numerically steady flux (silence, a
      // steady tone) cannot read as an onset, and a silent history still
      // fires when a real attack arrives.
      const floor = Math.max(1e-9, mean * 0.05);
      z = (flux - mean) / Math.max(Math.sqrt(variance), floor);
    }
    this.history.push(flux);
    if (this.history.length > this.window) this.history.shift();
    const onset = z > this.threshold && this.framesSinceOnset >= this.refractory;
    if (onset) this.framesSinceOnset = 0;
    return { flux, z, onset };
  }
}

export interface TempoEstimate {
  bpm: number;
  /** 0 to 1: the autocorrelation of the best lag. */
  confidence: number;
  /** The lag in samples (onset-strength frames) that produced the estimate. */
  lagFrames: number;
}

// Live tempo for the adaptive fallback clock (DS-23): autocorrelation of the
// onset-strength envelope over the plausible BPM range. The halving pass
// prefers the faster of two equally strong periods, which keeps a steady
// 120 BPM click train from reading as 60 BPM.
export function tempoFromOnsets(
  strengths: readonly number[],
  hopSeconds: number,
  opts: { minBpm?: number; maxBpm?: number } = {},
): TempoEstimate | null {
  if (hopSeconds <= 0 || strengths.length < 8) return null;
  const minBpm = opts.minBpm ?? 60;
  const maxBpm = opts.maxBpm ?? 200;
  const minLag = Math.max(2, Math.ceil(60 / (maxBpm * hopSeconds)));
  const maxLag = Math.floor(60 / (minBpm * hopSeconds));
  if (maxLag <= minLag) return null;
  let mean = 0;
  for (const value of strengths) mean += value;
  mean /= strengths.length;
  const centred = strengths.map((value) => value - mean);
  const score = (lag: number): number => {
    let dot = 0;
    let left = 0;
    let right = 0;
    for (let i = 0; i + lag < centred.length; i += 1) {
      const a = centred[i]!;
      const b = centred[i + lag]!;
      dot += a * b;
      left += a * a;
      right += b * b;
    }
    const norm = Math.sqrt(left * right);
    return norm > 0 ? dot / norm : 0;
  };
  let bestLag = minLag;
  let bestScore = score(minLag);
  for (let lag = minLag + 1; lag <= maxLag; lag += 1) {
    const candidate = score(lag);
    if (candidate > bestScore) {
      bestScore = candidate;
      bestLag = lag;
    }
  }
  while (bestLag >= minLag * 2) {
    const half = Math.round(bestLag / 2);
    if (half < minLag) break;
    const halfScore = score(half);
    if (halfScore < 0.9 * bestScore) break;
    bestLag = half;
    bestScore = halfScore;
  }
  return { bpm: 60 / (bestLag * hopSeconds), confidence: Math.min(1, Math.max(0, bestScore)), lagFrames: bestLag };
}

// AGC over whole frames: one agcStep per frame on the frame RMS. The gain
// drives the frame toward the target level; the envelope rises fast and
// decays slowly (audio.agc.rise / audio.agc.decay).
export class FrameAgc {
  private state: AgcState = { gain: 1, smoothed: 0 };

  constructor(private readonly config: { rise?: number; decay?: number; target?: number } = {}) {}

  process(frame: Float64Array): { gain: number; envelope: number } {
    let sum = 0;
    for (const sample of frame) sum += sample * sample;
    const rms = frame.length === 0 ? 0 : Math.sqrt(sum / frame.length);
    this.state = agcStep(this.state, rms, this.config);
    return { gain: this.state.gain, envelope: this.state.smoothed };
  }
}

export interface LiveFeatures {
  /** Frame RMS after AGC, clamped to 1. */
  level: number;
  /** Frame peak, clamped to 1. */
  peak: number;
  /** Mean power per live band, in LIVE_BAND_ORDER. */
  bands: [number, number, number, number];
  /** Fraction of the total band power per band; sums to 1 when power is present. */
  bandMix: [number, number, number, number];
  /** Mel band energies, `audio.melBands` long. */
  mel: Float64Array;
  flux: number;
  onset: boolean;
  /** Live tempo estimate for DS-23; null until enough onsets are seen. */
  tempo: TempoEstimate | null;
  /** AGC gain after this frame. */
  gain: number;
}

export interface LiveFeatureExtractorOptions {
  sampleRate: number;
  fftSize?: number;
  hopSize?: number;
  melBands?: number;
  onsetThreshold?: number;
  tempoMinBpm?: number;
  tempoMaxBpm?: number;
}

// One live feature frame per hop: the extractor keeps a ring of the most
// recent `audio.fftSize` samples, so overlapping hops (analysis.frame.hop)
// are supported. Every field is computed from the spectrum; nothing is
// carried over except the detector history and the AGC state.
export class LiveFeatureExtractor {
  private readonly sampleRate: number;
  private readonly fftSize: number;
  private readonly hopSize: number;
  private readonly fft: Fft;
  private readonly filters: Float64Array[];
  private readonly detector: OnsetDetector;
  private readonly agc: FrameAgc;
  private readonly tempoMinBpm: number;
  private readonly tempoMaxBpm: number;
  private readonly ring: Float64Array;
  private readonly scratch: Float64Array;
  private readonly onsets: number[] = [];
  private write = 0;

  constructor(opts: LiveFeatureExtractorOptions) {
    this.sampleRate = opts.sampleRate;
    this.fftSize = opts.fftSize ?? DEFAULT_FFT_SIZE;
    this.hopSize = opts.hopSize ?? DEFAULT_HOP_SIZE;
    this.fft = new Fft(this.fftSize);
    this.filters = melFilterbank({
      sampleRate: opts.sampleRate,
      fftSize: this.fftSize,
      bands: opts.melBands ?? DEFAULT_MEL_BANDS,
    });
    this.detector = new OnsetDetector({
      threshold: opts.onsetThreshold ?? DEFAULT_ONSET_THRESHOLD,
      refractoryFrames: Math.max(1, Math.ceil(this.fftSize / this.hopSize)),
    });
    this.agc = new FrameAgc();
    this.tempoMinBpm = opts.tempoMinBpm ?? 60;
    this.tempoMaxBpm = opts.tempoMaxBpm ?? 200;
    this.ring = new Float64Array(this.fftSize);
    this.scratch = new Float64Array(this.fftSize);
  }

  /** Push one hop of samples; returns the features of the newest window. */
  push(samples: Float64Array): LiveFeatures {
    for (const sample of samples) {
      this.ring[this.write] = sample;
      this.write = (this.write + 1) % this.ring.length;
    }
    if (this.write === 0) {
      this.scratch.set(this.ring);
    } else {
      const tail = this.ring.length - this.write;
      this.scratch.set(this.ring.subarray(this.write), 0);
      this.scratch.set(this.ring.subarray(0, this.write), tail);
    }
    const power = this.fft.power(this.scratch);
    const result = this.detector.push(power);
    const mel = melEnergies(power, this.filters);
    const bands = bandEnergies(power, this.sampleRate, this.fftSize);
    const total = bands[0] + bands[1] + bands[2] + bands[3];
    const mix = (total > 0 ? bands.map((value) => value / total) : [0, 0, 0, 0]) as [number, number, number, number];
    const { gain } = this.agc.process(this.scratch);
    let peak = 0;
    for (const sample of this.scratch) peak = Math.max(peak, Math.abs(sample));
    this.onsets.push(result.flux);
    if (this.onsets.length > 512) this.onsets.shift();
    const tempo = tempoFromOnsets(this.onsets, this.hopSize / this.sampleRate, {
      minBpm: this.tempoMinBpm,
      maxBpm: this.tempoMaxBpm,
    });
    let sum = 0;
    for (const sample of this.scratch) sum += sample * sample;
    const rms = Math.sqrt(sum / this.scratch.length);
    return {
      level: Math.min(1, rms * gain),
      peak: Math.min(1, peak * gain),
      bands,
      bandMix: mix,
      mel,
      flux: result.flux,
      onset: result.onset,
      tempo,
      gain,
    };
  }
}
