// Provider contract (T-LIVE-01, spec 6, spec 9.5, spec 120 item 14).
//
// Every DJ live source in this package and in WP09 emits the same
// `ProviderDeckState`: the spec 9.5 `DeckState` fields plus a generation
// token, beat/pitch/sync/loop-roll/hot-cue/phrase fields, and per-field
// source and quality labels. Downstream code never branches on which
// provider produced a state.
//
// Generation contract: every provider increments `generation` on track load,
// unload and replacement, and never emits a field belonging to the previous
// generation after the increment.
import type { DeckState } from "@autolight/contracts";

export interface BeatPoint {
  readonly index: number;
  readonly beatInBar: number | null;
  readonly sourceTimeMs: number;
}

export interface HotCueEvent {
  readonly number: number;
  readonly atNs: bigint;
}

export interface PhraseInfo {
  readonly current: string | null;
  readonly next: string | null;
  readonly countInBeats: number | null;
}

export interface LoopRollState {
  readonly active: boolean;
  readonly beatLength: number | null;
}

export type QualityLabel = "exact" | "derived" | "estimated" | "stale";

export interface ProviderDeckState extends DeckState {
  generation: number;
  beat: number | null;
  beatInBar: 1 | 2 | 3 | 4 | null;
  pitchPercent: number | null;
  sync: boolean | null;
  loopRoll: LoopRollState | null;
  lastHotCue: HotCueEvent | null;
  phrase: PhraseInfo | null;
  fieldSources: Partial<Record<keyof ProviderDeckState, string>>;
  quality: Partial<Record<keyof ProviderDeckState, QualityLabel>>;
  raw?: unknown;
}

export type ProviderId =
  | "lighting-ipc"
  | "memory-cleanroom"
  | "rkbx-osc"
  | "prolink"
  | "composite-flx4"
  | "ax"
  | "os2l";

export const DEFAULT_FUSION_AUTHORITY: readonly ProviderId[] = [
  "lighting-ipc",
  "memory-cleanroom",
  "rkbx-osc",
  "prolink",
  "composite-flx4",
  "ax",
  "os2l",
];

export type ProviderStatus =
  | { state: "starting" }
  | { state: "live"; updateHz: number; ageMs: number }
  | { state: "degraded"; reason: string; updateHz: number; ageMs: number }
  | { state: "unavailable"; reason: string; remedy: string }
  | { state: "failed"; error: string };

export interface ProviderCapabilities {
  readonly master: boolean;
  readonly loop: boolean;
  readonly pitch: boolean;
  readonly sync: boolean;
  readonly hotCue: boolean;
  readonly roll: boolean;
}

export interface ProviderStats {
  readonly received: number;
  readonly rejected: number;
  readonly queueDepth: number;
}

export interface DJLiveProvider {
  readonly id: string;
  readonly source: "rekordbox" | "serato";
  start(): Promise<void>;
  stop(): Promise<void>;
  getStatus(): ProviderStatus;
  getDecks(): readonly ProviderDeckState[];
  onDeckState(listener: (state: ProviderDeckState) => void): () => void;
  onConnection(listener: (status: ProviderStatus) => void): () => void;
  getCapabilities(): ProviderCapabilities;
  getStats(): ProviderStats;
}

// Deterministic clock: providers take `now` from an injected function so the
// contract suite and the fusion tests run on a virtual clock.
export type ClockFn = () => bigint;

export function systemClock(): bigint {
  return BigInt(Date.now()) * 1_000_000n;
}

export function describeStatus(status: ProviderStatus): string {
  if (status.state === "live") return `live ${status.updateHz.toFixed(1)} Hz, ${Math.round(status.ageMs)} ms old`;

  if (status.state === "degraded") return `degraded: ${status.reason}`;

  if (status.state === "unavailable") return `unavailable: ${status.reason}`;

  if (status.state === "failed") return `failed: ${status.error}`;

  return "starting";
}

// Shared lifecycle bookkeeping: idempotent start/stop, bounded latest-wins
// listeners, monotonic timestamps and a received/rejected tally.
export abstract class ProviderBase implements DJLiveProvider {
  readonly id: string;
  readonly source: "rekordbox" | "serato";
  protected readonly now: ClockFn;
  protected readonly listeners = new Set<(state: ProviderDeckState) => void>();
  protected readonly statusListeners = new Set<(status: ProviderStatus) => void>();
  protected status: ProviderStatus = { state: "starting" };
  protected received = 0;
  protected rejected = 0;
  protected queueDepth = 0;
  protected started = false;
  private starting: Promise<void> | null = null;
  protected lastStateAtNs = 0n;

  constructor(id: string, source: "rekordbox" | "serato", now: ClockFn = systemClock) {
    this.id = id;
    this.source = source;
    this.now = now;
  }

  async start(): Promise<void> {
    const inFlight = this.starting;

    // Concurrent callers await the same initialization instead of returning
    // before it finishes.
    if (inFlight !== null) return inFlight;

    if (this.started) return;
    this.started = true;

    const run = (async () => {
      try {
        await this.onStart();
      } catch (err) {
        // A failed start must not leave the provider reporting "running".
        this.started = false;
        throw err;
      } finally {
        this.starting = null;
      }
    })();

    this.starting = run;

    return run;
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    // Clear the flag only once onStop resolves, so a rejecting stop can retry.
    await this.onStop();
    this.started = false;
  }

  protected async onStart(): Promise<void> {}
  protected async onStop(): Promise<void> {}

  getStatus(): ProviderStatus {
    return this.status;
  }

  abstract getDecks(): readonly ProviderDeckState[];
  abstract getCapabilities(): ProviderCapabilities;

  getStats(): ProviderStats {
    return { received: this.received, rejected: this.rejected, queueDepth: this.queueDepth };
  }

  onDeckState(listener: (state: ProviderDeckState) => void): () => void {
    this.listeners.add(listener);

    return () => this.listeners.delete(listener);
  }

  onConnection(listener: (status: ProviderStatus) => void): () => void {
    this.statusListeners.add(listener);

    return () => this.statusListeners.delete(listener);
  }

  protected setStatus(status: ProviderStatus): void {
    this.status = status;

    for (const l of this.statusListeners) l(status);
  }

  protected emit(state: ProviderDeckState): void {
    this.received += 1;
    this.queueDepth = Math.min(1, this.queueDepth + 1);

    if (state.receivedAtNs <= this.lastStateAtNs) {
      // Mutate the received object so callers and listeners observe the same
      // monotonic stamp, not two divergent copies.
      state.receivedAtNs = this.lastStateAtNs + 1n;
    }

    this.lastStateAtNs = state.receivedAtNs;

    try {
      for (const l of this.listeners) l(state);
    } finally {
      // Latest-wins dispatch is synchronous: the queue drains when it returns.
      this.queueDepth = Math.max(0, this.queueDepth - 1);
    }
  }

  protected markRejected(reason: string): void {
    this.rejected += 1;

    if (this.status.state === "live" || this.status.state === "degraded") {
      this.setStatus({ state: "degraded", reason, updateHz: 0, ageMs: 0 });
    }
  }
}

// Deterministic, in-memory provider used by tests and by the contract suite.
// The simulator-backed providers in the app follow the same lifecycle.
export interface TrackHint {
  readonly id?: string;
  readonly title?: string;
  readonly artist?: string;
  readonly canonicalPath?: string;
}

export interface UpdateHint {
  readonly deckId: number;
  readonly atNs?: bigint;
  readonly playing?: boolean;
  readonly playheadSeconds?: number;
  readonly playRate?: number;
  readonly effectiveBpm?: number | null;
  readonly track?: TrackHint | null;
  readonly beat?: number | null;
  readonly beatInBar?: 1 | 2 | 3 | 4 | null;
  readonly pitchPercent?: number | null;
  readonly sync?: boolean | null;
  readonly loopRoll?: LoopRollState | null;
  readonly hotCue?: HotCueEvent | null;
  readonly phrase?: PhraseInfo | null;
  readonly master?: boolean | null;
  readonly channelFader?: number | null;
  readonly crossfader?: number | null;
  readonly quality?: Partial<Record<keyof ProviderDeckState, QualityLabel>>;
}

// Maps a transport update onto a provider state, incrementing the generation
// on every load, unload and replacement and keeping the track text that was
// last reported for the deck.
export class DeckGenerationMapper {
  private readonly generations = new Map<number, number>();
  private readonly tracks = new Map<number, ProviderDeckState["track"]>();
  private readonly trackKeys = new Map<number, string | null>();
  private readonly beats = new Map<number, number>();
  private readonly qualities = new Map<number, Partial<Record<keyof ProviderDeckState, QualityLabel>>>();

  update(providerId: string, hint: UpdateHint): ProviderDeckState {
    const deckId = hint.deckId;
    const incoming = hint.track === undefined ? undefined : toTrack(hint.track);
    const previous = this.tracks.get(deckId) ?? null;

    if (incoming !== undefined) {
      const nextKey = trackKey(incoming);

      if (nextKey !== (this.trackKeys.get(deckId) ?? null)) {
        this.generations.set(deckId, (this.generations.get(deckId) ?? 0) + 1);
        // A new generation starts clean: no field from the old track survives.
        this.beats.delete(deckId);
        this.qualities.delete(deckId);
        this.trackKeys.set(deckId, nextKey);
      }

      this.tracks.set(deckId, incoming);
    }

    const track = incoming !== undefined ? incoming : previous;
    const generation = this.generations.get(deckId) ?? 0;
    const beat = hint.beat === undefined ? (this.beats.get(deckId) ?? null) : hint.beat;

    if (beat !== null) this.beats.set(deckId, beat);

    // Providers may report quality incrementally; merge so labels for fields
    // this message did not touch are not silently dropped.
    const quality = { ...this.qualities.get(deckId), ...hint.quality };

    this.qualities.set(deckId, quality);

    const state: ProviderDeckState = {
      source: "rekordbox",
      deckId,
      track,
      playing: hint.playing ?? false,
      playheadSeconds: hint.playheadSeconds ?? 0,
      playRate: hint.playRate ?? 1,
      effectiveBpm: hint.effectiveBpm ?? null,
      loop: { active: false, startSeconds: null, endSeconds: null, beatLength: null },
      channelFader: hint.channelFader ?? null,
      crossfader: hint.crossfader ?? null,
      master: hint.master ?? null,
      receivedAtNs: hint.atNs ?? 0n,
      generation,
      beat,
      beatInBar: hint.beatInBar ?? null,
      pitchPercent: hint.pitchPercent ?? null,
      sync: hint.sync ?? null,
      loopRoll: hint.loopRoll ?? null,
      lastHotCue: hint.hotCue ?? null,
      phrase: hint.phrase ?? null,
      fieldSources: {
        track: providerId,
        playing: providerId,
        playheadSeconds: providerId,
        effectiveBpm: providerId,
        ...(hint.channelFader !== undefined ? { channelFader: providerId } : {}),
        ...(hint.crossfader !== undefined ? { crossfader: providerId } : {}),
      },
      quality,
    };

    return state;
  }
}

// Stable identity for a deck's loaded track: the id plus the fields that keep
// two distinct id-less tracks from collapsing onto the same sentinel.
function trackKey(track: ProviderDeckState["track"]): string | null {
  if (track === null) return null;

  return `${track.id}\u0000${track.canonicalPath ?? ""}\u0000${track.title ?? ""}\u0000${track.artist ?? ""}`;
}

function toTrack(hint: TrackHint | null): ProviderDeckState["track"] {
  if (hint === null) return null;

  return {
    id: hint.id ?? "unknown",
    sourceIds: {},
    ...(hint.canonicalPath ? { canonicalPath: hint.canonicalPath } : {}),
    ...(hint.title ? { title: hint.title } : {}),
    ...(hint.artist ? { artist: hint.artist } : {}),
  };
}

// A provider the contract suite drives deterministically: the test controls
// every update, including deliberately malformed input.
export class ScriptedProvider extends ProviderBase {
  private readonly mapper = new DeckGenerationMapper();
  private readonly decks = new Map<number, ProviderDeckState>();
  private readonly capabilities: ProviderCapabilities;

  constructor(opts: { id?: string; now?: ClockFn; capabilities?: Partial<ProviderCapabilities> } = {}) {
    super(opts.id ?? "scripted", "rekordbox", opts.now);
    this.capabilities = {
      master: true, loop: true, pitch: true, sync: true, hotCue: true, roll: true,
      ...opts.capabilities,
    };
  }

  protected async onStart(): Promise<void> {
    this.setStatus({ state: "starting" });
  }

  report(status: ProviderStatus): void {
    this.setStatus(status);
  }

  update(hint: UpdateHint): ProviderDeckState {
    const existing = this.decks.get(hint.deckId);
    const state = this.mapper.update(this.id, { ...hint, atNs: hint.atNs ?? this.now() });
    const merged: ProviderDeckState = { ...state, master: hint.master ?? existing?.master ?? null };
    this.decks.set(hint.deckId, merged);
    this.emit(merged);

    return merged;
  }

  ingestMalformed(reason = "malformed datagram"): void {
    this.markRejected(reason);
  }

  setQueueDepth(depth: number): void {
    this.queueDepth = Math.max(0, depth);
  }

  getCapabilities(): ProviderCapabilities {
    return this.capabilities;
  }

  getDecks(): readonly ProviderDeckState[] {
    return [...this.decks.values()];
  }
}

// A provider that leaks the previous generation's metadata on purpose. It
// exists only to prove the contract suite catches this class of bug; the
// shared suite is expected to fail against it.
export class LeakyProvider extends ScriptedProvider {
  leakPreviousTitle(hint: UpdateHint & { staleTitle: string }): void {
    const leaked = {
      ...this.update(hint),
      track: { id: hint.track?.id ?? "new", sourceIds: {}, title: hint.staleTitle },
    };

    this.emit(leaked);
  }
}
