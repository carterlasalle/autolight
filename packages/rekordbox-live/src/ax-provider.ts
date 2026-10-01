// Accessibility provider (`ax`, T-LIVE-06, F-LIVE-05).
//
// One poller lives in the main process; this module holds the part that turns
// a dumped AX/UIA tree into per-deck state. It never guesses: a deck with no
// readable time emits nothing and the provider reports why, so the caller
// holds its last state instead of inventing one. Playhead quality is
// `estimated` (about one beat) and labelled as such.
import {
  axFractionalBeat,
  axPermissionState,
  readAxDecks,
  refineAxReading,
  type AxDeckReading,
  type AxNode,
} from "./ax.js";
import {
  DeckGenerationMapper,
  ProviderBase,
  type ClockFn,
  type ProviderCapabilities,
  type ProviderDeckState,
  type QualityLabel,
} from "./providers.js";

export interface AxProviderOptions {
  now?: ClockFn;
  intervalMs?: number;
  timeoutMs?: number;
  permissionGranted?: boolean;
}

export class AxProvider extends ProviderBase {
  private readonly capabilities: ProviderCapabilities = {
    master: false, loop: false, pitch: false, sync: false, hotCue: false, roll: false,
  };
  private readonly mapper = new DeckGenerationMapper();
  private readonly readings = new Map<number, AxDeckReading>();
  private readonly grids = new Map<number, readonly { sourceTimeMs: number }[]>();
  private readonly intervalMs: number;
  private readonly timeoutMs: number;
  private permissionGranted: boolean;
  private lastPollAtNs: bigint | null = null;

  constructor(opts: AxProviderOptions = {}) {
    super("ax", "rekordbox", opts.now);
    this.intervalMs = opts.intervalMs ?? 250;
    this.timeoutMs = opts.timeoutMs ?? 2000;
    this.permissionGranted = opts.permissionGranted ?? true;
  }

  protected async onStart(): Promise<void> {
    if (!this.permissionGranted) {
      const permission = axPermissionState(false);
      this.setStatus({ state: "unavailable", reason: "Accessibility permission not granted", remedy: permission.remedy });
      return;
    }
    this.setStatus({ state: "starting" });
  }

  getCapabilities(): ProviderCapabilities {
    return this.capabilities;
  }

  getDecks(): readonly ProviderDeckState[] {
    return [...this.readings.keys()].sort((a, b) => a - b).map((deck) => this.stateFor(deck));
  }

  getIntervalMs(): number {
    return this.intervalMs;
  }

  getTimeoutMs(): number {
    return this.timeoutMs;
  }

  setPermission(granted: boolean): void {
    this.permissionGranted = granted;
    if (!granted) {
      const permission = axPermissionState(false);
      this.setStatus({ state: "unavailable", reason: "Accessibility permission not granted", remedy: permission.remedy });
    }
  }

  setGrid(deckId: number, grid: readonly { sourceTimeMs: number }[]): void {
    this.grids.set(deckId, grid);
  }

  latestReadings(): AxDeckReading[] {
    return [...this.readings.values()].sort((a, b) => a.deckId - b.deckId);
  }

  // In-flight coalescing: a poll that arrives while the previous one is still
  // unresolved is dropped, never queued (live.ax.intervalMs / timeoutMs).
  ingestTree(root: readonly AxNode[], atNs?: bigint): AxDeckReading[] {
    const at = atNs ?? this.now();
    if (this.lastPollAtNs !== null && Number(at - this.lastPollAtNs) / 1e6 < this.intervalMs) {
      return [];
    }
    this.lastPollAtNs = at;
    if (!this.permissionGranted) {
      const permission = axPermissionState(false);
      this.setStatus({ state: "unavailable", reason: "Accessibility permission not granted", remedy: permission.remedy });
      return [];
    }
    const readings = readAxDecks(root);
    if (readings.length === 0) {
      this.markRejected("AX tree has no deck containers");
      this.setStatus({ state: "degraded", reason: "AX tree has no deck containers", updateHz: 0, ageMs: 0 });
      return [];
    }
    const emitted: AxDeckReading[] = [];
    let unreadable = 0;
    for (const reading of readings) {
      const refined = refineAxReading(reading, this.readings.get(reading.deckId));
      this.readings.set(refined.deckId, refined);
      if (!refined.readable) {
        unreadable += 1;
        continue;
      }
      emitted.push(refined);
      this.emit(this.stateFor(refined.deckId, at));
    }
    const updateHz = this.intervalMs > 0 ? 1000 / this.intervalMs : 0;
    this.setStatus(unreadable === 0
      ? { state: "live", updateHz, ageMs: 0 }
      : { state: "degraded", reason: `${unreadable} deck(s) not readable`, updateHz, ageMs: 0 });
    return emitted;
  }

  private stateFor(deck: number, atNs?: bigint): ProviderDeckState {
    const reading = this.readings.get(deck);
    const elapsed = reading?.elapsedSeconds ?? reading?.remainingSeconds ?? null;
    const grid = this.grids.get(deck);
    const beat = elapsed === null || !grid || grid.length === 0 ? null : axFractionalBeat(elapsed, grid);
    const state = this.mapper.update(this.id, {
      deckId: deck,
      atNs: atNs ?? this.now(),
      playing: reading?.playing ?? false,
      playheadSeconds: elapsed ?? 0,
      effectiveBpm: null,
      track: reading?.title
        ? { id: `ax:${reading.title}`, title: reading.title, ...(reading.artist ? { artist: reading.artist } : {}) }
        : null,
      beat,
      quality: this.qualityFor(reading),
    });
    return {
      ...state,
      raw: { provider: "ax", readable: reading?.readable ?? false, remainingSeconds: reading?.remainingSeconds ?? null },
    };
  }

  private qualityFor(reading: AxDeckReading | undefined): Partial<Record<keyof ProviderDeckState, QualityLabel>> {
    return {
      playheadSeconds: "estimated",
      playing: reading?.playing === null ? "estimated" : "derived",
      beat: "derived",
      track: "estimated",
    };
  }
}
