// Track load fast path plus prepared-show upgrade (T-RUN-08, spec 138, 140).
//
// On a new generation: resolve identity (T-RBL-07), fetch the cached
// TrackModel and ShowPlan through the storage fast path (T-DATA-04), install
// into the deck world, update the UI. No ML on this path. Upgrades (a better
// plan arriving mid-track, a style change, a planner edit) install only at a
// clean boundary (`runtime.upgrade.boundary`, default phrase) with a look
// crossfade (spec 140). `loadFastPath` here returns parsed objects, never a
// path string (F-RUN-09).
import type { ShowPlan, TrackModel } from "@autolight/contracts";
import { resolveLiveTrack, type LiveTrackInput, type Resolution } from "@autolight/rekordbox-library";
import { loadFastPath, type FastPathMiss, type FastPathRequest } from "@autolight/storage";
import type { Store } from "@autolight/storage";
import { MemoryAliasStore } from "@autolight/track-identity";
import { createDeckWorld, installModel, installPlan, type DeckWorld } from "./index.js";

export type UpgradeBoundary = "section" | "phrase" | "bar";

/** runtime.upgrade.boundary default. */
export const DEFAULT_UPGRADE_BOUNDARY: UpgradeBoundary = "phrase";
/** runtime.fastPath.budgetMs default: load event to installed plan. */
export const DEFAULT_FAST_PATH_BUDGET_MS = 100;

export interface FastPathLoad {
  track: TrackModel | null;
  plan: ShowPlan | null;
  miss: FastPathMiss | null;
  detail: string | null;
  cacheHit: boolean;
  totalMs: number;
}

export interface GenerationLoad extends FastPathLoad {
  generation: number;
  resolution: Resolution;
  /** Install when true; when false the load is parked for the boundary. */
  installed: boolean;
}

export interface FastPathDeps {
  store: Store;
  makeId?: () => string;
  analyzeNow?: (trackId: string) => void;
  compileNow?: (trackId: string) => void;
}

/**
 * New generation handler (spec 138): resolve, fetch cached model and plan,
 * install into the deck world. Missing plan with a model present means
 * compile in the planner worker; nothing cached means best available level
 * now (STRUCTURED from native data, ADAPTIVE otherwise) plus a top-priority
 * analysis queue. Returns parsed objects either way.
 */
export function loadGeneration(
  world: DeckWorld,
  generation: number,
  input: LiveTrackInput,
  request: Omit<FastPathRequest, "trackId"> & { trackId?: string },
  deps: FastPathDeps,
  aliasStore: MemoryAliasStore = new MemoryAliasStore(),
): GenerationLoad {
  const started = performance.now();
  const makeId = deps.makeId ?? (() => `gen:${generation}:${Date.now()}`);
  const resolution = resolveLiveTrack(aliasStore, input, makeId);
  if (resolution.trackId === null) {
    deps.analyzeNow?.(`unknown:${generation}`);
    return {
      generation, resolution, track: null, plan: null, miss: "no-artifact",
      detail: "unresolved track: queued top-priority analysis, ADAPTIVE until it lands",
      cacheHit: false, totalMs: performance.now() - started, installed: false,
    };
  }
  const full: FastPathRequest = { ...request, trackId: resolution.trackId };
  const loaded = loadFastPath(deps.store, full);
  if (loaded.track !== null && loaded.plan !== null) {
    installModel(world, generation, loaded.track);
    installPlan(world, generation, loaded.plan);
    return {
      generation, resolution, track: loaded.track, plan: loaded.plan, miss: null,
      detail: null, cacheHit: loaded.timings.cacheHit, totalMs: performance.now() - started, installed: true,
    };
  }
  if (loaded.track !== null) {
    installModel(world, generation, loaded.track);
    deps.compileNow?.(resolution.trackId);
    return {
      generation, resolution, track: loaded.track, plan: null, miss: loaded.miss ?? "no-plan",
      detail: "plan missing: installed STRUCTURED model, compiling in planner worker",
      cacheHit: loaded.timings.cacheHit, totalMs: performance.now() - started, installed: true,
    };
  }
  deps.analyzeNow?.(resolution.trackId);
  return {
    generation, resolution, track: null, plan: null, miss: loaded.miss,
    detail: loaded.detail, cacheHit: false, totalMs: performance.now() - started, installed: false,
  };
}

export interface UpgradeProposal {
  plan: ShowPlan;
  /** Current beat; the upgrade waits for the next boundary at or after it. */
  beat: number;
  boundary: UpgradeBoundary;
  /** Phrase boundaries in beats (section ends when phrases are unknown). */
  phraseBoundaries: number[];
  sectionBoundaries: number[];
}

export interface UpgradeDecision {
  installAtBeat: number;
  /** Beats to wait; zero means install on this tick. */
  waitBeats: number;
  boundary: UpgradeBoundary;
}

/**
 * Clean-boundary upgrade (spec 140): a better plan or a style change never
 * lands mid-phrase during audible playback. Phrase default, section and bar
 * overrides. Crossfade of looks is the renderer's envelope blend at the
 * boundary beat; this function picks the beat.
 */
export function upgradeAtBoundary(proposal: UpgradeProposal): UpgradeDecision {
  const pool = proposal.boundary === "phrase"
    ? proposal.phraseBoundaries
    : proposal.boundary === "section"
      ? proposal.sectionBoundaries
      : phraseOrBar(proposal);
  const next = pool.filter((b) => b >= proposal.beat).sort((a, b) => a - b)[0];
  if (next === undefined) return { installAtBeat: proposal.beat, waitBeats: 0, boundary: proposal.boundary };
  return { installAtBeat: next, waitBeats: next - proposal.beat, boundary: proposal.boundary };
}

function phraseOrBar(proposal: UpgradeProposal): number[] {
  if (proposal.phraseBoundaries.length > 0) return proposal.phraseBoundaries;
  const out: number[] = [];
  const start = Math.ceil(proposal.beat);
  for (let b = start; b < start + 64; b++) out.push(b);
  return out;
}

/** Install a decided upgrade into the world (same-tick state, spec 140). */
export function installUpgrade(world: DeckWorld, generation: number, plan: ShowPlan): void {
  installPlan(world, generation, plan);
}

/** Test seam: a world with one generation installed, for timing harnesses. */
export function worldWithPlan(deckId: number, generation: number, track: TrackModel, plan: ShowPlan): DeckWorld {
  const world = createDeckWorld(deckId, { generation });
  installModel(world, generation, track);
  installPlan(world, generation, plan);
  return world;
}
