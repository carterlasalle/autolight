// Compile performance and caching (T-PLAN-14, spec 138). Plans cache by the
// five determinism inputs; a single-section edit recompiles only that
// section and splices it into the cached cue list.
import { stableStringify } from "./types.js";

export interface PlanCacheKey {
  readonly fingerprint: string;
  readonly plannerVersion: string;
  readonly styleHash: string;
  readonly venueHash: string;
  readonly configHash: string;
}

export function cacheKeyFor(k: PlanCacheKey): string {
  return stableStringify([k.fingerprint, k.plannerVersion, k.styleHash, k.venueHash, k.configHash]);
}

export class PlanCache<T> {
  private store = new Map<string, T>();
  private hits = 0;
  private misses = 0;

  constructor(private readonly maxEntries = 200) {}

  get(key: PlanCacheKey): T | undefined {
    const k = cacheKeyFor(key);

    if (!this.store.has(k)) {
      this.misses++;

      return undefined;
    }

    this.hits++;
    const v = this.store.get(k)!;
    this.store.delete(k);
    this.store.set(k, v);

    return v;
  }

  set(key: PlanCacheKey, value: T): void {
    const k = cacheKeyFor(key);

    if (this.store.has(k)) this.store.delete(k);

    const cap = Math.max(1, this.maxEntries);

    while (this.store.size >= cap) {
      const oldest = this.store.keys().next();

      if (oldest.done) break;

      this.store.delete(oldest.value);
    }

    this.store.set(k, value);
  }

  stats(): { hits: number; misses: number; size: number } {
    return { hits: this.hits, misses: this.misses, size: this.store.size };
  }

  clear(): void {
    this.store.clear();
    this.hits = 0;
    this.misses = 0;
  }
}

export interface SpliceableCue {
  readonly startBeat: number;
}

// Replace cues in [start, end) with fresh cues, keeping everything else in
// order. Used for incremental single-section recompile.
export function spliceSection<T extends SpliceableCue>(
  cues: readonly T[],
  start: number,
  end: number,
  fresh: readonly T[],
): T[] {
  const outside = cues.filter((c) => c.startBeat < start || c.startBeat >= end);

  return [...outside, ...fresh].sort((a, b) => a.startBeat - b.startBeat);
}
