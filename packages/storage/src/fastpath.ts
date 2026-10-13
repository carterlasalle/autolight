import { readFileSync } from "node:fs";
import { showPlanSchema, trackModelSchema, type ShowPlan, type TrackModel } from "@autolight/contracts";
import { artifactKey, planKey, type ArtifactKeyParts, type PlanKeyParts } from "./cache.js";
import type { Store } from "./index.js";
import { percentile } from "./perf.js";

// Fast path loader (T-DATA-04, spec 138, P-138). Track load resolves to
// parsed and validated TrackModel and ShowPlan objects, served from an
// in-memory LRU over the database rows and the artifact files. No ML runs in
// this path. A miss is typed. The artifact path on disk is never returned as
// the track model (F-DATA-04).

export interface FastPathRequest extends ArtifactKeyParts, PlanKeyParts {}

export type FastPathMiss = "no-artifact" | "invalid-artifact" | "no-plan" | "invalid-plan";

export interface FastPathTimings {
  totalMs: number;
  lookupMs: number;
  parseMs: number;
  cacheHit: boolean;
}

export interface FastPathResult {
  track: TrackModel | null;
  plan: ShowPlan | null;
  miss: FastPathMiss | null;
  detail: string | null;
  key: string;
  timings: FastPathTimings;
}

interface CacheEntry {
  track: TrackModel;
  plan: ShowPlan | null;
  miss: FastPathMiss | null;
  detail: string | null;
}

const DEFAULT_CAPACITY = 32;

const TIMING_WINDOW = 512;

// Store-scoped keys: the request carries no store identity, so a plain global
// key would serve store A's rows to store B (reopened DB, second workspace,
// per-test temp DBs). resetFastPath() keeps clearing everything, so existing
// zero-arg callers stay isolated per test.
const lru = new Map<string, CacheEntry>();

const loadTimingsMs: number[] = [];

function now(): number {
  return performance.now();
}

const storeIds = new WeakMap<object, number>();

let nextStoreId = 1;

function storeId(store: Store): number {
  const existing = storeIds.get(store);

  if (existing !== undefined) return existing;
  const created = nextStoreId++;
  storeIds.set(store, created);

  return created;
}

function lruGet(store: Store, key: string): CacheEntry | undefined {
  const entry = lru.get(`${storeId(store)}::${key}`);

  if (!entry) return undefined;
  lru.delete(`${storeId(store)}::${key}`);
  lru.set(`${storeId(store)}::${key}`, entry);

  return entry;
}

function lruSet(store: Store, key: string, entry: CacheEntry, capacity: number): void {
  const scoped = `${storeId(store)}::${key}`;

  if (lru.has(scoped)) lru.delete(scoped);
  lru.set(scoped, entry);

  while (lru.size > capacity) {
    const oldest = lru.keys().next().value;

    if (oldest === undefined) break;
    lru.delete(oldest);
  }
}

function recordTiming(store: Store, ms: number): void {
  void store;
  loadTimingsMs.push(ms);

  if (loadTimingsMs.length > TIMING_WINDOW) loadTimingsMs.shift();
}

export function resetFastPath(): void {
  lru.clear();
  loadTimingsMs.length = 0;
}

// Drops the parsed objects but keeps the recorded timings, so a cold-load
// timing run does not have to clear its own samples.
export function clearFastPathCache(): void {
  lru.clear();
}

export function fastPathCacheSize(): number {
  return lru.size;
}

export interface FastPathStats {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

export function fastPathTimings(): FastPathStats {
  return {
    count: loadTimingsMs.length,
    p50: percentile(loadTimingsMs, 50),
    p95: percentile(loadTimingsMs, 95),
    p99: percentile(loadTimingsMs, 99),
    max: loadTimingsMs.length > 0 ? Math.max(...loadTimingsMs) : 0,
  };
}

// The blocked check for spec 138: p95 of the load path against
// `runtime.fastPath.budgetMs`.
export function fastPathBudget(budgetMs: number): { budgetMs: number; p95: number; count: number; pass: boolean } {
  const stats = fastPathTimings();

  return { budgetMs, p95: stats.p95, count: stats.count, pass: stats.count > 0 && stats.p95 <= budgetMs };
}

export interface LoadOptions {
  capacity?: number;
}

export function loadFastPath(store: Store, request: FastPathRequest, options: LoadOptions = {}): FastPathResult {
  const key = `${planKey(request)}::${artifactKey(request)}`;
  const started = now();
  const cached = lruGet(store, key);

  if (cached) {
    const totalMs = now() - started;

    return {
      track: cached.track,
      plan: cached.plan,
      miss: cached.miss,
      detail: cached.detail,
      key,
      timings: { totalMs, lookupMs: 0, parseMs: 0, cacheHit: true },
    };
  }

  const lookupStarted = now();
  const artifact = store.artifactRow(request);
  const planRow = store.planRow(request);
  const lookupMs = now() - lookupStarted;

  if (!artifact) {
    const totalMs = now() - started;
    recordTiming(store, totalMs);

    return {
      track: null,
      plan: null,
      miss: "no-artifact",
      detail: `no cached TrackModel for track ${request.trackId} at analyzer ${request.analyzerVersion}`,
      key,
      timings: { totalMs, lookupMs, parseMs: 0, cacheHit: false },
    };
  }

  const parseStarted = now();
  let track: TrackModel | null = null;
  let detail: string | null = null;

  try {
    // The row holds an artifact path. Reading the file is the only way to a
    // TrackModel; the path itself is never the answer.
    track = trackModelSchema.parse(JSON.parse(readFileSync(artifact.artifact_path, "utf8")));
  } catch (error) {
    detail = `artifact ${artifact.artifact_path} did not parse to a TrackModel: ${error instanceof Error ? error.message : String(error)}`;
  }

  const parseMs = now() - parseStarted;

  if (!track) {
    const totalMs = now() - started;
    recordTiming(store, totalMs);

    return {
      track: null,
      plan: null,
      miss: "invalid-artifact",
      detail,
      key,
      timings: { totalMs, lookupMs, parseMs, cacheHit: false },
    };
  }

  let plan: ShowPlan | null = null;
  let planDetail: string | null = null;

  if (planRow) {
    try {
      const parsed = showPlanSchema.parse(JSON.parse(planRow.plan_json));

      if (parsed.trackId !== request.trackId || parsed.styleId !== request.styleId) {
        planDetail = `plan key mismatch: trackId ${parsed.trackId}, styleId ${parsed.styleId}`;
      } else {
        plan = parsed;
      }
    } catch (error) {
      planDetail = `plan row did not parse to a ShowPlan: ${error instanceof Error ? error.message : String(error)}`;
    }
  } else {
    planDetail = "no cached plan; compile from cached features (spec 138 step 2)";
  }

  let miss: FastPathMiss | null;

  if (plan) miss = null;
  else if (planRow) miss = "invalid-plan";
  else miss = "no-plan";

  // Cache the positive track row only: a null-plan entry would pin a stale
  // miss after a plan lands, so plan availability is always re-read.
  if (plan) lruSet(store, key, { track, plan, miss, detail: planDetail }, options.capacity ?? DEFAULT_CAPACITY);
  const totalMs = now() - started;
  recordTiming(store, totalMs);

  return {
    track,
    plan,
    miss,
    detail: plan ? null : planDetail,
    key,
    timings: { totalMs, lookupMs, parseMs, cacheHit: false },
  };
}
