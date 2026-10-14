// PCM fingerprint for track identity (spec 12, DS-34, T-ID-01).
//
// `identity.fingerprint.mode`:
//   pcm-hash  SHA-256 of the canonical decode (T-ANA-03: 44.1 kHz float
//             stereo, quantized to 16-bit) which survives rename, move and
//             tag edits exactly but not a re-encode;
//   acoustic  Chromaprint-style similarity for matching re-encodes (own
//             implementation over the documented algorithm: spectral-peak
//             landmark hashes over the canonical PCM, never GPL code);
//   both      exact pcm-hash first, acoustic similarity above
//             `identity.fingerprint.acousticThreshold` proposes a "probably
//             the same track" link the owner confirms in the Library, never
//             an auto-merge (combined, default).
//
// OD-08: fpcalc stays out of the installer unless the owner accepts the LGPL
// binary; the acoustic path here needs no external binary.

type FingerprintMode = "pcm-hash" | "acoustic" | "both";

/** identity.fingerprint.mode default: the DS-34 combined mode. */

/** identity.fingerprint.acousticThreshold default. */
const DEFAULT_ACOUSTIC_THRESHOLD = 0.9;

/** Canonical samples quantized to 16-bit before hashing (one channel pair). */
export function quantize16(samples: Float32Array | readonly number[]): Int16Array {
  const out = new Int16Array(samples.length);

  for (let i = 0; i < samples.length; i++) {
    const v = Math.min(1, Math.max(-1, samples[i] ?? 0));
    out[i] = Math.round(v * 32767);
  }

  return out;
}

/**
 * Exact fingerprint: SHA-256 hex of the quantized canonical PCM. Pure so
 * tests pin it without crypto imports at the call site.
 */
export async function pcmHashOf(quantized: Int16Array | Uint8Array): Promise<string> {
  // Explicit little-endian bytes: reading the typed array's buffer would hash
  // the host's native byte order and break exact matches across endianness.
  const bytes = quantized instanceof Uint8Array ? Uint8Array.from(quantized) : int16ToLittleEndian(quantized);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function int16ToLittleEndian(samples: Int16Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(samples.length * 2);

  for (let i = 0; i < samples.length; i++) {
    const value = samples[i] ?? 0;

    out[i * 2] = value & 0xff;
    out[i * 2 + 1] = (value >> 8) & 0xff;
  }

  return out;
}

export interface AcousticOptions {
  /** Similarity at or above this proposes a link (never auto-merges). */
  threshold?: number;
}

/**
 * Acoustic similarity in [0, 1] between two landmark-hash sets. Documented
 * Chromaprint-style approach: each side is a set of spectral-peak landmark
 * hashes; similarity is the Jaccard overlap. Re-encodes keep most landmarks,
 * different tracks share almost none.
 */
export function acousticSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let both = 0;

  for (const h of setA) if (setB.has(h)) both++;

  return both / (setA.size + setB.size - both);
}

/** True when the acoustic overlap proposes a link the owner must confirm. */
export function acousticProposesLink(a: readonly number[], b: readonly number[], options: AcousticOptions = {}): boolean {
  return acousticSimilarity(a, b) >= (options.threshold ?? DEFAULT_ACOUSTIC_THRESHOLD);
}

const BAND_COUNT = 8;

const BAND_LOW_HZ = 100;

const BAND_TOP_HZ = 6000;

const DEFAULT_SAMPLE_RATE = 44100;

/**
 * Landmark hashes from canonical mono PCM. One hash per window: the indices of
 * the two strongest of 8 octave-spaced frequency bands — Goertzel band energy
 * over a Hann-windowed frame, so the peaks are spectral, not time-positional —
 * packed with the window index. Deterministic and dependency-free.
 */
export function landmarkHashes(
  mono: Float32Array | readonly number[],
  windowSize = 1024,
  hopSize = 512,
  sampleRate = DEFAULT_SAMPLE_RATE,
): number[] {
  if (!Number.isFinite(windowSize) || windowSize <= 0 || !Number.isFinite(hopSize) || hopSize <= 0) {
    throw new RangeError(`landmarkHashes: windowSize and hopSize must be positive (got ${windowSize}/${hopSize})`);
  }

  const hashes: number[] = [];
  const hann = hannWindow(windowSize);
  const coefficients = bandCoefficients(sampleRate);
  const energy = new Array<number>(BAND_COUNT).fill(0);

  for (let start = 0; start + windowSize <= mono.length; start += hopSize) {
    for (let b = 0; b < BAND_COUNT; b++) energy[b] = bandEnergy(mono, start, hann, coefficients[b]!);

    let first = 0;
    let second = 1;

    for (let b = 0; b < BAND_COUNT; b++) {
      if (energy[b]! > energy[first]!) {
        second = first;
        first = b;
      } else if (b !== first && energy[b]! > energy[second]!) {
        second = b;
      }
    }

    // Full window index, not an 8-bit truncation: windows 256 hops apart must
    // not alias to the same hash (drones would collapse to a handful of
    // landmarks and inflate Jaccard similarity).
    const windowIndex = start / hopSize;

    hashes.push(windowIndex * (BAND_COUNT * BAND_COUNT) + first * BAND_COUNT + second);
  }

  return hashes;
}

// Octave-spaced band edges from 100 Hz to 6 kHz: the Goertzel coefficients for
// a pure-tone evaluation per band, standard recurrence form.
function bandCoefficients(sampleRate: number): Float64Array {
  const coefficients = new Float64Array(BAND_COUNT);

  for (let b = 0; b < BAND_COUNT; b++) {
    const hz = BAND_LOW_HZ * Math.pow(BAND_TOP_HZ / BAND_LOW_HZ, b / (BAND_COUNT - 1));

    coefficients[b] = 2 * Math.cos((2 * Math.PI * hz) / sampleRate);
  }

  return coefficients;
}

function hannWindow(size: number): Float64Array {
  const window = new Float64Array(size);

  for (let i = 0; i < size; i++) window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));

  return window;
}

// Goertzel power at one band: |X(f)|^2 without a transform per band.
function bandEnergy(
  samples: Float32Array | readonly number[],
  start: number,
  hann: Float64Array,
  coefficient: number,
): number {
  let s1 = 0;
  let s2 = 0;

  for (let i = 0; i < hann.length; i++) {
    const s0 = (samples[start + i] ?? 0) * hann[i]! + coefficient * s1 - s2;

    s2 = s1;
    s1 = s0;
  }

  return s1 * s1 + s2 * s2 - coefficient * s1 * s2;
}
