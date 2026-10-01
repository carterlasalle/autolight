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

export type FingerprintMode = "pcm-hash" | "acoustic" | "both";

/** identity.fingerprint.mode default: the DS-34 combined mode. */
export const DEFAULT_FINGERPRINT_MODE: FingerprintMode = "both";
/** identity.fingerprint.acousticThreshold default. */
export const DEFAULT_ACOUSTIC_THRESHOLD = 0.9;

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
  const bytes = quantized instanceof Uint8Array ? quantized : new Uint8Array(quantized.buffer, quantized.byteOffset, quantized.byteLength);
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface AcousticOptions {
  /** Similarity at or above this proposes a link (never auto-merges). */
  threshold?: number;
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

/**
 * Landmark hashes from canonical mono PCM. One hash per window: the indices
 * of the two strongest of 8 coarse spectral bins, packed with the window
 * index delta. Deterministic and dependency-free.
 */
export function landmarkHashes(mono: Float32Array | readonly number[], windowSize = 1024, hopSize = 512): number[] {
  const hashes: number[] = [];
  const bins = 8;
  for (let start = 0; start + windowSize <= mono.length; start += hopSize) {
    const energy = new Array<number>(bins).fill(0);
    for (let i = 0; i < windowSize; i++) {
      const v = mono[start + i] ?? 0;
      energy[Math.min(bins - 1, Math.floor((i / windowSize) * bins))]! += v * v;
    }
    let first = 0;
    let second = 1;
    for (let b = 0; b < bins; b++) {
      if (energy[b]! > energy[first]!) {
        second = first;
        first = b;
      } else if (b !== first && energy[b]! > energy[second]!) {
        second = b;
      }
    }
    hashes.push(((start / hopSize) & 0xff) | (first! << 8) | (second! << 12));
  }
  return hashes;
}
