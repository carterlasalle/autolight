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

export interface SeedPick {
  value: string;
  source: SeedSource;
  weak: boolean;
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
  let pick: SeedPick;

  if (input.pcmFingerprint !== undefined && input.pcmFingerprint !== "") {
    pick = { value: `pcm:${input.pcmFingerprint}`, source: "pcm-fingerprint", weak: false };
  } else if (input.fileHash !== undefined && input.fileHash !== "") {
    pick = { value: `hash:${input.fileHash}`, source: "file-hash", weak: false };
  } else if (input.nativeId !== undefined && input.nativeId !== "") {
    pick = { value: `id:${input.nativeId}`, source: "native-id-weak", weak: true };
  } else {
    throw new Error("derivePlannerSeed needs a pcmFingerprint, fileHash, or nativeId; refusing the shared id:unknown sentinel");
  }

  const seed = createHash("sha256")
    .update(`${pick.value}|${plannerVersion}|${styleId}`)
    .digest("hex")
    .slice(0, 16);

  return { seed, seedSource: pick.source, weak: pick.weak };
}

/** Mulberry32 stream for the planner; kept here so the seed has one consumer. */
export function seedStream(seedHex: string): () => number {
  if (!/^[0-9a-fA-F]{8,16}$/.test(seedHex)) {
    throw new Error("seedStream needs 8-16 hex chars");
  }

  const hi = parseInt(seedHex.slice(0, 8), 16) >>> 0;
  const loHex = seedHex.slice(8, 16);
  const lo = loHex.length > 0 ? parseInt(loHex.padEnd(8, "0"), 16) >>> 0 : 0;
  // Fold both digest halves into the 32-bit state so seeds that differ
  // only past char 8 still diverge; 8-char legacy seeds keep state hi.
  let a = (hi ^ lo) >>> 0;

  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
