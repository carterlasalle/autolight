// Planner seed from the fingerprint (spec 27, T-ID-02, P-27-seed-fingerprint).
//
// The seed is derived from pcmFingerprint, falling back to fileHash, then to
// the native ID with a recorded "weak seed" flag. The plan records
// seedSource, so Diagnostics shows when a seed is weak. Two identities with
// the same fingerprint and different database IDs produce byte-identical
// plans: the fingerprint is the only identity input to the seed.
import { createHash } from "node:crypto";

export type SeedSource = "pcm-fingerprint" | "file-hash" | "native-id-weak";

export interface SeedInput {
  pcmFingerprint?: string;
  fileHash?: string;
  /** Native fallback: rekordbox ID, serato path or canonical path. */
  nativeId?: string;
}

export interface PlannerSeed {
  seed: string;
  seedSource: SeedSource;
  /** True when the seed fell back past the fingerprint. */
  weak: boolean;
}

/**
 * Derive the planner seed. Fingerprint first; fileHash second; native ID
 * last with weak=true. The seed is a stable hex digest of the chosen input
 * plus planner version and style ID, all of which PlannerM3 folds into
 * plan.determinism.
 */
export function derivePlannerSeed(input: SeedInput, plannerVersion: string, styleId: string): PlannerSeed {
  const pick: { value: string; source: SeedSource; weak: boolean } =
    input.pcmFingerprint !== undefined && input.pcmFingerprint !== ""
      ? { value: `pcm:${input.pcmFingerprint}`, source: "pcm-fingerprint", weak: false }
      : input.fileHash !== undefined && input.fileHash !== ""
        ? { value: `hash:${input.fileHash}`, source: "file-hash", weak: false }
        : { value: `id:${input.nativeId ?? "unknown"}`, source: "native-id-weak", weak: true };
  const seed = createHash("sha256")
    .update(`${pick.value}|${plannerVersion}|${styleId}`)
    .digest("hex")
    .slice(0, 16);
  return { seed, seedSource: pick.source, weak: pick.weak };
}

/** Mulberry32 stream for the planner; kept here so the seed has one consumer. */
export function seedStream(seedHex: string): () => number {
  let a = parseInt(seedHex.slice(0, 8), 16) >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
