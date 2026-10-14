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

interface FastPathLoad {
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
// Callers that do not thread their own store share one module-level store:
// a fresh store per call would drop every alias learned by the previous
// call, and alias learning is the store's whole purpose (batch-09).
const defaultAliasStore = new MemoryAliasStore();

export function loadGeneration(
  world: DeckWorld,
  generation: number,
  input: LiveTrackInput,
  request: Omit<FastPathRequest, "trackId"> & { trackId?: string },
  deps: FastPathDeps,
  aliasStore: MemoryAliasStore = defaultAliasStore,
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
    detail: loaded.detail, cacheHit: loaded.timings.cacheHit, totalMs: performance.now() - started, installed: false,
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
  let pool: number[];

  if (proposal.boundary === "phrase") pool = proposal.phraseBoundaries;
  else if (proposal.boundary === "section") pool = proposal.sectionBoundaries;
  else pool = phraseOrBar(proposal);

  const next = pool.filter((b) => b >= proposal.beat).sort((a, b) => a - b)[0];

  if (next === undefined) {
    // Past every known boundary (a lagging plan): waiting would never end,
    // so install now and let the next proposal re-target (batch-09).
    return { installAtBeat: proposal.beat, waitBeats: 0, boundary: proposal.boundary };
  }

  return { installAtBeat: next, waitBeats: next - proposal.beat, boundary: proposal.boundary };
}

function phraseOrBar(proposal: UpgradeProposal): number[] {
  // "bar" mode: phrase lines when the plan knows them (a coarser but always
  // clean boundary), else every four beats from here — the proposal carries
  // no meter, so 4/4 is the documented assumption. The old every-beat pool
  // made a bar setting install on the very next beat (batch-09).
  if (proposal.phraseBoundaries.length > 0) return proposal.phraseBoundaries;
  const out: number[] = [];
  let b = Math.ceil(proposal.beat / 4) * 4;

  for (let i = 0; i < 16; i++) {
    out.push(b);
    b += 4;
  }

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
