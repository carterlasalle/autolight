// Fusion provider and manager (T-LIVE-02, DS-01, spec 7, spec 105).
//
// `live.provider` picks one provider or `fusion` (the default). Fusion ranks
// field authority per field, extended with the owner's sources:
// lighting-ipc, memory-cleanroom, rkbx-osc, prolink, composite-flx4, ax, os2l.
// Each field comes from the highest-ranked provider whose value is fresh
// (live.provider.staleMs) and whose quality is not stale; authority changes
// only after the challenger has been fresh for live.fusion.switchHoldMs
// (hysteresis), and every change is a switch event. Playhead and BPM are
// cross-validated and a diagnostic is raised when providers disagree by more
// than live.fusion.disagreeBeats.
import {
  DEFAULT_FUSION_AUTHORITY,
  describeStatus,
  type DJLiveProvider,
  type ProviderDeckState,
  type ProviderStatus,
  type QualityLabel,
} from "./providers.js";

export const FUSION_FIELDS = [
  "track", "playing", "playheadSeconds", "playRate", "effectiveBpm", "loop",
  "channelFader", "crossfader", "master", "beat", "beatInBar", "pitchPercent",
  "sync", "loopRoll", "lastHotCue", "phrase",
] as const;

export type FusionField = (typeof FUSION_FIELDS)[number];

export interface FusionSwitchEvent {
  atNs: bigint;
  deckId: number;
  field: FusionField;
  from: string | null;
  to: string;
  reason: "acquired" | "higher-authority" | "stale-takeover" | "quality";
}

export interface FusionDiagnostic {
  atNs: bigint;
  deckId: number;
  field: "playheadSeconds" | "effectiveBpm";
  providers: string[];
  spread: number;
  threshold: number;
}

export interface FusionOptions {
  authority: readonly string[];
  staleMs: number;
  switchHoldMs: number;
  disagreeBeats: number;
}

export const DEFAULT_FUSION_OPTIONS: FusionOptions = {
  authority: DEFAULT_FUSION_AUTHORITY,
  staleMs: 500,
  switchHoldMs: 500,
  disagreeBeats: 0.25,
};

interface Holder {
  provider: string;
  pending: { provider: string; sinceNs: bigint } | null;
}

function supplied(state: ProviderDeckState, field: FusionField): boolean {
  const value = state[field];
  if (value === null || value === undefined) return false;
  return true;
}

function isFresh(state: ProviderDeckState, field: FusionField, atNs: bigint, staleMs: number): boolean {
  if (state.quality[field] === "stale") return false;
  return Number(atNs - state.receivedAtNs) / 1e6 <= staleMs;
}

function beatsBetween(a: ProviderDeckState, b: ProviderDeckState): number {
  const bpm = a.effectiveBpm ?? b.effectiveBpm ?? 120;
  return Math.abs(a.playheadSeconds - b.playheadSeconds) * (bpm / 60);
}

// BPM disagreement projected to one bar of drift, so the same threshold unit
// (beats) covers both fields.
function bpmBeatsBetween(a: ProviderDeckState, b: ProviderDeckState): number {
  const bpmA = a.effectiveBpm;
  const bpmB = b.effectiveBpm;
  if (bpmA === null || bpmB === null) return 0;
  const max = Math.max(bpmA, bpmB, 1);
  return (Math.abs(bpmA - bpmB) / max) * 4;
}

export class FusionEngine {
  private readonly options: FusionOptions;
  private readonly now: () => bigint;
  private readonly latest = new Map<string, Map<number, ProviderDeckState>>();
  private readonly holders = new Map<string, Holder>();
  private readonly events: FusionSwitchEvent[] = [];
  private readonly diagnostics: FusionDiagnostic[] = [];
  private readonly switchCounts: Record<string, number> = {};
  private fusedByDeck = new Map<number, ProviderDeckState>();

  constructor(opts: { now: () => bigint } & Partial<FusionOptions>) {
    this.options = { ...DEFAULT_FUSION_OPTIONS, ...opts, authority: opts.authority ?? DEFAULT_FUSION_AUTHORITY };
    this.now = opts.now;
  }

  getOptions(): FusionOptions {
    return { ...this.options, authority: [...this.options.authority] };
  }

  ingest(providerId: string, state: ProviderDeckState): void {
    let decks = this.latest.get(providerId);
    if (!decks) {
      decks = new Map();
      this.latest.set(providerId, decks);
    }
    const previous = decks.get(state.deckId);
    if (previous && state.receivedAtNs < previous.receivedAtNs) return;
    decks.set(state.deckId, state);
    this.recompute(state.deckId);
  }

  fusedDecks(): ProviderDeckState[] {
    return [...this.fusedByDeck.values()];
  }

  fused(deckId: number): ProviderDeckState | null {
    return this.fusedByDeck.get(deckId) ?? null;
  }

  // Re-evaluates every deck against the current clock without new input, so a
  // provider that went silent shows up as stale instead of looking fresh
  // until the next packet arrives.
  refresh(): void {
    for (const deckId of [...this.fusedByDeck.keys()]) this.recompute(deckId);
  }

  drainEvents(): FusionSwitchEvent[] {
    return this.events.splice(0, this.events.length);
  }

  drainDiagnostics(): FusionDiagnostic[] {
    return this.diagnostics.splice(0, this.diagnostics.length);
  }

  counts(): Record<string, number> {
    return { ...this.switchCounts };
  }

  private rank(providerId: string): number {
    const index = this.options.authority.indexOf(providerId);
    return index === -1 ? this.options.authority.length : index;
  }

  private recompute(deckId: number): void {
    const atNs = this.now();
    const perProvider: { provider: string; state: ProviderDeckState }[] = [];
    for (const [provider, decks] of this.latest) {
      const state = decks.get(deckId);
      if (state) perProvider.push({ provider, state });
    }
    perProvider.sort((a, b) => this.rank(a.provider) - this.rank(b.provider));

    const sources: Partial<Record<keyof ProviderDeckState, string>> = {};
    const quality: Partial<Record<keyof ProviderDeckState, QualityLabel>> = {};
    const winners = new Map<FusionField, ProviderDeckState>();
    for (const field of FUSION_FIELDS) {
      const candidates = perProvider.filter((c) => supplied(c.state, field) && isFresh(c.state, field, atNs, this.options.staleMs));
      const key = `${deckId}:${field}`;
      const holder = this.holders.get(key);
      const winner = this.pick(key, field, holder, candidates, atNs, deckId);
      if (winner !== null) {
        const found = perProvider.find((c) => c.provider === winner);
        if (found) {
          winners.set(field, found.state);
          sources[field] = winner;
          quality[field] = isFresh(found.state, field, atNs, this.options.staleMs)
            ? (found.state.quality[field] ?? "derived")
            : "stale";
        }
      }
    }

    const generation = perProvider.reduce((max, c) => Math.max(max, c.state.generation), 0);
    const master = winners.get("master")?.master ?? null;
    const fused: ProviderDeckState = {
      source: perProvider[0]?.state.source ?? "rekordbox",
      deckId,
      track: winners.get("track")?.track ?? null,
      playing: winners.get("playing")?.playing ?? false,
      playheadSeconds: winners.get("playheadSeconds")?.playheadSeconds ?? 0,
      playRate: winners.get("playRate")?.playRate ?? 1,
      effectiveBpm: winners.get("effectiveBpm")?.effectiveBpm ?? null,
      loop: winners.get("loop")?.loop ?? { active: false, startSeconds: null, endSeconds: null, beatLength: null },
      channelFader: winners.get("channelFader")?.channelFader ?? null,
      crossfader: winners.get("crossfader")?.crossfader ?? null,
      master,
      receivedAtNs: atNs,
      generation,
      beat: winners.get("beat")?.beat ?? null,
      beatInBar: winners.get("beatInBar")?.beatInBar ?? null,
      pitchPercent: winners.get("pitchPercent")?.pitchPercent ?? null,
      sync: winners.get("sync")?.sync ?? null,
      loopRoll: winners.get("loopRoll")?.loopRoll ?? null,
      lastHotCue: winners.get("lastHotCue")?.lastHotCue ?? null,
      phrase: winners.get("phrase")?.phrase ?? null,
      fieldSources: sources,
      quality,
    };
    this.fusedByDeck.set(deckId, fused);
    this.checkDisagreement(deckId, atNs, perProvider);
  }

  // Hysteresis: the current authority keeps the field unless a higher-ranked
  // or fresher challenger stays available for switchHoldMs.
  private pick(
    key: string,
    field: FusionField,
    holder: Holder | undefined,
    candidates: readonly { provider: string; state: ProviderDeckState }[],
    atNs: bigint,
    deckId: number,
  ): string | null {
    const holdNs = BigInt(Math.round(this.options.switchHoldMs)) * 1_000_000n;
    if (!holder) {
      const first = candidates[0];
      if (!first) return null;
      this.holders.set(key, { provider: first.provider, pending: null });
      this.emitSwitch(deckId, field, null, first.provider, "acquired", atNs);
      return first.provider;
    }
    const currentFresh = candidates.find((c) => c.provider === holder.provider);
    const better = currentFresh
      ? candidates.find((c) => this.rank(c.provider) < this.rank(holder.provider))
      : candidates[0];
    if (!better || better.provider === holder.provider) {
      // Nothing outranks the holder: clear any pending challenger and keep
      // the holder, which stays labelled stale while it is not fresh.
      this.holders.set(key, { provider: holder.provider, pending: null });
      return holder.provider;
    }
    const pending = holder.pending;
    if (pending?.provider === better.provider && atNs - pending.sinceNs >= holdNs) {
      this.holders.set(key, { provider: better.provider, pending: null });
      this.emitSwitch(
        deckId, field, holder.provider, better.provider,
        currentFresh ? "higher-authority" : "stale-takeover", atNs,
      );
      return better.provider;
    }
    this.holders.set(key, { provider: holder.provider, pending: otherPending(holder, better.provider, atNs) });
    if (currentFresh) return holder.provider;
    // Holder is stale and the takeover hold has not elapsed: keep the holder
    // value but label it stale so consumers can see it is not fresh.
    return holder.provider;
  }

  private emitSwitch(
    deckId: number,
    field: FusionField,
    from: string | null,
    to: string,
    reason: FusionSwitchEvent["reason"],
    atNs: bigint,
  ): void {
    this.events.push({ atNs, deckId, field, from, to, reason });
    this.switchCounts[to] = (this.switchCounts[to] ?? 0) + 1;
  }

  private checkDisagreement(
    deckId: number,
    atNs: bigint,
    perProvider: readonly { provider: string; state: ProviderDeckState }[],
  ): void {
    const fresh = perProvider.filter((c) => isFresh(c.state, "playheadSeconds", atNs, this.options.staleMs));
    if (fresh.length < 2) return;
    const groups: { field: FusionDiagnostic["field"]; measure: (a: ProviderDeckState, b: ProviderDeckState) => number }[] = [
      { field: "playheadSeconds", measure: beatsBetween },
      { field: "effectiveBpm", measure: bpmBeatsBetween },
    ];
    for (const group of groups) {
      let spread = 0;
      let pair: [string, string] | null = null;
      for (let i = 0; i < fresh.length; i++) {
        for (let j = i + 1; j < fresh.length; j++) {
          const a = fresh[i]!;
          const b = fresh[j]!;
          if (group.field === "effectiveBpm" && (a.state.effectiveBpm === null || b.state.effectiveBpm === null)) continue;
          const d = group.measure(a.state, b.state);
          if (d > spread) {
            spread = d;
            pair = [a.provider, b.provider];
          }
        }
      }
      if (pair && spread > this.options.disagreeBeats) {
        this.diagnostics.push({
          atNs,
          deckId,
          field: group.field,
          providers: pair,
          spread,
          threshold: this.options.disagreeBeats,
        });
      }
    }
  }
}

function otherPending(holder: Holder | undefined, provider: string, atNs: bigint): Holder["pending"] {
  if (holder?.pending?.provider === provider) return holder.pending;
  return { provider, sinceNs: atNs };
}

export interface DeckStatePort {
  onDeckState(listener: (state: ProviderDeckState) => void): () => void;
  drainPending(): ProviderDeckState[];
}

// Bounded, latest-wins-per-deck forwarding port (spec 105, S26).
export class LatestWinsPort implements DeckStatePort {
  private readonly latest = new Map<number, ProviderDeckState>();
  private readonly listeners = new Set<(state: ProviderDeckState) => void>();

  push(state: ProviderDeckState): void {
    this.latest.set(state.deckId, state);
  }

  drainPending(): ProviderDeckState[] {
    const out = [...this.latest.values()];
    this.latest.clear();
    return out;
  }

  onDeckState(listener: (state: ProviderDeckState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  flush(): void {
    for (const state of this.drainPending()) {
      for (const listener of this.listeners) listener(state);
    }
  }
}

export interface ProviderManagerOptions {
  providers: readonly DJLiveProvider[];
  authority?: readonly string[];
  staleMs?: number;
  switchHoldMs?: number;
  disagreeBeats?: number;
  maxRestarts?: number;
  restartBackoffMs?: number;
}

export interface ProviderManagerDeps {
  now: () => bigint;
  schedule?: (fn: () => void, ms: number) => void;
}

// Starts the providers enabled for the chosen source, supervises them with
// restart backoff, and forwards fused deck state latest-wins per deck.
export class ProviderManager {
  private readonly providers: readonly DJLiveProvider[];
  private readonly fusion: FusionEngine;
  private readonly port = new LatestWinsPort();
  private readonly statuses = new Map<string, ProviderStatus>();
  private readonly restarts = new Map<string, number>();
  private readonly restartsInFlight = new Set<Promise<void>>();
  private readonly unsubscribes: (() => void)[] = [];
  private readonly schedule: (fn: () => void, ms: number) => void;
  private readonly maxRestarts: number;
  private readonly restartBackoffMs: number;
  private started = false;

  constructor(opts: ProviderManagerOptions, deps: ProviderManagerDeps) {
    this.providers = opts.providers;
    this.fusion = new FusionEngine({
      now: deps.now,
      ...(opts.authority ? { authority: opts.authority } : {}),
      ...(opts.staleMs !== undefined ? { staleMs: opts.staleMs } : {}),
      ...(opts.switchHoldMs !== undefined ? { switchHoldMs: opts.switchHoldMs } : {}),
      ...(opts.disagreeBeats !== undefined ? { disagreeBeats: opts.disagreeBeats } : {}),
    });
    this.schedule = deps.schedule ?? ((fn, ms) => setTimeout(fn, ms));
    this.maxRestarts = opts.maxRestarts ?? 3;
    this.restartBackoffMs = opts.restartBackoffMs ?? 500;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    for (const provider of this.providers) {
      this.unsubscribes.push(provider.onDeckState((state) => {
        this.fusion.ingest(provider.id, state);
        const fused = this.fusion.fused(state.deckId);
        if (fused) this.port.push(fused);
      }));
      this.unsubscribes.push(provider.onConnection((status) => {
        this.statuses.set(provider.id, status);
        if (status.state === "failed") this.restart(provider);
      }));
      try {
        await provider.start();
        this.statuses.set(provider.id, provider.getStatus());
      } catch (err) {
        this.statuses.set(provider.id, { state: "failed", error: err instanceof Error ? err.message : String(err) });
        this.restart(provider);
      }
    }
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    for (const off of this.unsubscribes.splice(0)) off();
    for (const provider of this.providers) await provider.stop();
  }

  // Restart supervision is asynchronous; tests and shutdown await it here.
  async settleRestarts(): Promise<void> {
    await Promise.all([...this.restartsInFlight]);
  }

  statusesByName(): Record<string, ProviderStatus> {
    return Object.fromEntries([...this.statuses.entries()]);
  }

  describe(): string[] {
    return [...this.statuses.entries()].map(([id, status]) => `${id}: ${describeStatus(status)}`);
  }

  fusedDecks(): ProviderDeckState[] {
    return this.fusion.fusedDecks();
  }

  drainEvents(): FusionSwitchEvent[] {
    return this.fusion.drainEvents();
  }

  drainDiagnostics(): FusionDiagnostic[] {
    return this.fusion.drainDiagnostics();
  }

  onDeckState(listener: (state: ProviderDeckState) => void): () => void {
    return this.port.onDeckState(listener);
  }

  flush(): void {
    this.fusion.refresh();
    for (const state of this.fusion.fusedDecks()) this.port.push(state);
    this.port.flush();
  }

  private restart(provider: DJLiveProvider): void {
    const attempts = this.restarts.get(provider.id) ?? 0;
    if (attempts >= this.maxRestarts) {
      this.statuses.set(provider.id, {
        state: "failed",
        error: `provider ${provider.id} failed ${attempts} times; restart budget exhausted`,
      });
      return;
    }
    this.restarts.set(provider.id, attempts + 1);
    const attempt = Promise.withResolvers<void>();
    this.restartsInFlight.add(attempt.promise);
    this.schedule(() => {
      void provider.stop()
        .then(() => provider.start())
        .then(() => {
          this.statuses.set(provider.id, provider.getStatus());
        })
        .catch((err: unknown) => {
          this.statuses.set(provider.id, { state: "failed", error: err instanceof Error ? err.message : String(err) });
          this.restart(provider);
        })
        .finally(() => {
          this.restartsInFlight.delete(attempt.promise);
          attempt.resolve();
        });
    }, this.restartBackoffMs * (attempts + 1));
  }
}
