// Composite FLX4 provider (`composite-flx4`, T-LIVE-07, F-LIVE-06, F-LIVE-07).
//
// Inputs, each from its own real subsystem:
// - FLX4 controller events (T-FLX-06 feed in `@autolight/controller-flx4`): play,
//   cue, jog, tempo fader, sync, loops, pads, faders and crossfader per deck.
//   MIDI is secondary truth (spec 11): it confirms and hints, never overrides
//   a DJ software playhead. Inside this provider there is no stronger source,
//   so MIDI transport edges drive the estimate and are labelled derived or
//   estimated, never exact.
// - Library resolver (WP06): LOAD press plus track-open observation resolves
//   to a track id, title and native grid.
// - Ableton Link peer (T-LIVE-12 seam): when a Link tempo is supplied it
//   cross-checks effective BPM, labelled derived.
// - Audio timing correction: the master loopback envelope is cross-correlated
//   with the track precomputed onset envelope around the estimated position
//   (window `live.composite.correlationWindowMs`); corrections slew in through
//   a rate-limited path like the estimator smooth correction (T-RUN-02), so
//   the playhead never steps backwards while playing.
//
// Track-open observation: the host polls the Rekordbox process open files
// (`lsof -p <pid>` on macOS at `live.composite.openFilePollMs`, filtered to
// audio extensions under the library roots) and this provider correlates the
// result with the FLX4 LOAD press per deck. The lister is injected, so tests
// and the Windows native helper (or its UNAVAILABLE_ON_THIS_DEVICE report)
// plug in without touching this file.
//
// Quality: playhead `estimated` until correlation locks, then `derived` with
// the correlation confidence. Playing and faders are observed directly:
// playing `derived`, faders `exact`.
import {
  DeckGenerationMapper,
  ProviderBase,
  type ClockFn,
  type HotCueEvent,
  type ProviderCapabilities,
  type ProviderDeckState,
  type QualityLabel,
  type TrackHint,
} from "./providers.js";

export const COMPOSITE_PROVIDER_ID = "composite-flx4" as const;

export type CompositeDeck = 1 | 2;

export type CompositeControl =
  | "play"
  | "cue"
  | "sync"
  | "load"
  | "hotcue"
  | "loop-in"
  | "loop-out"
  | "loop-exit"
  | "loop-halve"
  | "loop-double"
  | "pad-roll"
  | "jog-touch"
  | "jog-move"
  | "channel-fader"
  | "crossfader"
  | "filter"
  | "tempo";

// One controller action. `deck` 0 is the master strip (crossfader only); every
// other control carries its deck. Buttons use value 1 (down) and 0 (up);
// continuous controls are normalized 0 to 1 except `jog-move`, which is a
// signed velocity. The T-FLX-06 feed maps decoded MIDI onto this shape; the
// T-FLX-02 full map feeds the same shape for controls beyond the transport
// and fader subset.
export interface CompositeControllerEvent {
  readonly deck: CompositeDeck | 0;
  readonly control: CompositeControl;
  readonly value: number;
  readonly pad: number | null;
  readonly atNs: bigint;
}

export interface CompositeTrackResolution {
  readonly id: string;
  readonly title: string | null;
  readonly artist: string | null;
  readonly canonicalPath: string | null;
  // Native grid anchors in source milliseconds; beat is the fractional index.
  readonly grid: readonly { sourceTimeMs: number }[] | null;
  readonly durationSeconds: number | null;
  // Precomputed onset envelope at `envelopeRateHz` frames per second.
  readonly onsetEnvelope: readonly number[] | null;
}

export interface CompositeResolveQuery {
  readonly path: string | null;
  readonly title: string | null;
  readonly artist: string | null;
  readonly bpm: number | null;
  readonly durationSeconds: number | null;
}

export type CompositeTrackResolver = (
  deck: CompositeDeck,
  query: CompositeResolveQuery,
) => CompositeTrackResolution | null;

export type OpenFilesLister = () => readonly string[];

export interface CompositeLinkTempo {
  readonly bpm: number;
  readonly beat: number;
  readonly atNs: bigint;
}

export interface CompositeProviderOptions {
  now?: ClockFn;
  listOpenFiles?: OpenFilesLister | null;
  resolveTrack?: CompositeTrackResolver | null;
  libraryRoots?: readonly string[];
  linkTempo?: () => CompositeLinkTempo | null;
  // Rekordbox tempo range in percent (6, 10, 16, wide = 24). The fitted value
  // from a DJ software provider (T-FLX-03 `flx4.tempoRange` source) overrides
  // this when supplied via setTempoRangePercent.
  tempoRangePercent?: number;
  envelopeRateHz?: number;
  correlationWindowMs?: number;
  lockThresholdMs?: number;
  minLockConfidence?: number;
  maxCorrectionMsPerTick?: number;
  eventTimeoutMs?: number;
  jogSecondsPerUnit?: number;
}

const AUDIO_EXTENSIONS = [".mp3", ".wav", ".aiff", ".aif", ".flac", ".m4a", ".ogg", ".opus"];

export const COMPOSITE_DEFAULTS = {
  tempoRangePercent: 10,
  envelopeRateHz: 50,
  correlationWindowMs: 4000,
  lockThresholdMs: 15,
  minLockConfidence: 0.6,
  maxCorrectionMsPerTick: 50,
  eventTimeoutMs: 2000,
  jogSecondsPerUnit: 0.1,
} as const;

// Pure: keep audio files under the library roots. The host lister returns raw
// process file paths; this filter is the only policy here.
export function matchLibraryAudio(
  files: readonly string[],
  roots: readonly string[],
): string[] {
  const out: string[] = [];
  for (const file of files) {
    const lower = file.toLowerCase();
    if (!AUDIO_EXTENSIONS.some((ext) => lower.endsWith(ext))) continue;
    if (!roots.some((root) => file.startsWith(root))) continue;
    out.push(file);
  }
  return out;
}

// Pure: fractional beat (index + fraction) at `seconds` over grid anchors.
export function gridBeatAt(
  grid: readonly { sourceTimeMs: number }[],
  seconds: number,
): number | null {
  if (grid.length === 0) return null;
  const ms = seconds * 1000;
  const first = grid[0]?.sourceTimeMs ?? 0;
  if (ms <= first) return 0;
  let lo = 0;
  for (let i = 1; i < grid.length; i++) {
    if ((grid[i]?.sourceTimeMs ?? Number.POSITIVE_INFINITY) <= ms) lo = i;
    else break;
  }
  const a = grid[lo]?.sourceTimeMs ?? first;
  const b = grid[lo + 1]?.sourceTimeMs;
  if (b === undefined || b <= a) return lo;
  return lo + (ms - a) / (b - a);
}

// Pure: local tempo in BPM from the grid segment around `seconds`.
export function gridBpmAt(
  grid: readonly { sourceTimeMs: number }[],
  seconds: number,
): number | null {
  if (grid.length < 2) return null;
  const ms = seconds * 1000;
  let lo = 0;
  for (let i = 1; i < grid.length; i++) {
    if ((grid[i]?.sourceTimeMs ?? Number.POSITIVE_INFINITY) <= ms) lo = i;
    else break;
  }
  const a = grid[lo]?.sourceTimeMs ?? 0;
  const b = grid[Math.min(lo + 1, grid.length - 1)]?.sourceTimeMs ?? a;
  if (b - a <= 0) return null;
  return 60000 / (b - a);
}

export interface CorrelationResult {
  readonly lagSamples: number;
  readonly confidence: number;
}

// Pure: normalized cross-correlation of `live` against `ref` for lags within
// +-maxLag samples. `ref` is the estimate-aligned segment (same clock as the
// estimate); a peak at lag L means live leads the prediction by L samples,
// so the correction adds -L samples to the estimate. Confidence is the peak
// coefficient 0..1. Shifts with fewer than a quarter of `live` overlapping
// `ref` are skipped: a one-sample overlap would score a perfect 1.
export function correlateEnvelopes(
  live: readonly number[],
  ref: readonly number[],
  maxLag: number,
): CorrelationResult {
  let bestLag = 0;
  let bestScore = 0;
  let found = false;
  const lag = Math.max(0, Math.floor(maxLag));
  const minOverlap = Math.max(8, Math.floor(live.length / 4));
  for (let shift = -lag; shift <= lag; shift++) {
    let num = 0;
    let liveNorm = 0;
    let refNorm = 0;
    let overlap = 0;
    for (let i = 0; i < live.length; i++) {
      const j = i - shift;
      if (j < 0 || j >= ref.length) continue;
      const l = live[i] ?? 0;
      const r = ref[j] ?? 0;
      num += l * r;
      liveNorm += l * l;
      refNorm += r * r;
      overlap += 1;
    }
    if (overlap < minOverlap || liveNorm <= 0 || refNorm <= 0) continue;
    const score = num / Math.sqrt(liveNorm * refNorm);
    if (!found || score > bestScore) {
      found = true;
      bestScore = score;
      bestLag = shift;
    }
  }
  return { lagSamples: found ? bestLag : 0, confidence: Math.min(1, Math.max(0, bestScore)) };
}

// Pure: weighted sum of per-deck reference envelopes by fader weight. With two
// decks audible the loopback hears the mix, so correlation runs against the
// mix and the result is attributed to the louder deck.
export function mixReferences(
  envelopes: readonly (readonly number[])[],
  weights: readonly number[],
): number[] {
  const length = envelopes.reduce((max, env) => Math.max(max, env.length), 0);
  const out = new Array<number>(length).fill(0);
  for (let e = 0; e < envelopes.length; e++) {
    const weight = weights[e] ?? 0;
    const env = envelopes[e];
    if (!env || weight <= 0) continue;
    for (let i = 0; i < env.length; i++) out[i] = (out[i] ?? 0) + (env[i] ?? 0) * weight;
  }
  return out;
}

// Pure: fit the tempo range from observed (fader, pitchFraction) pairs. The
// fader maps linearly: pitch = (fader - 0.5) * 2 * range. Median of implied
// ranges; null when no off-center sample exists.
export function estimateTempoRangePercent(
  samples: readonly { fader: number; pitchFraction: number }[],
): number | null {
  const implied: number[] = [];
  for (const sample of samples) {
    const deflection = Math.abs(sample.fader - 0.5) * 2;
    if (deflection < 0.05) continue;
    implied.push((Math.abs(sample.pitchFraction) * 100) / deflection);
  }
  if (implied.length === 0) return null;
  implied.sort((a, b) => a - b);
  return implied[Math.floor(implied.length / 2)] ?? null;
}

interface DeckEstimate {
  resolution: CompositeTrackResolution | null;
  hasTrack: boolean;
  playing: boolean;
  anchorPosSeconds: number;
  anchorAtNs: bigint;
  rate: number;
  cuePointSeconds: number;
  tempoFader: number;
  channelFader: number | null;
  filter: number | null;
  loopActive: boolean;
  loopStartBeat: number | null;
  loopBeatLength: number | null;
  sync: boolean | null;
  rollActive: boolean;
  rollBeats: number | null;
  lastHotCue: HotCueEvent | null;
  pendingLoadAtNs: bigint | null;
  locked: boolean;
  confidence: number;
  lastEventAtNs: bigint | null;
  lastEmitted: ProviderDeckState | null;
}

function emptyDeck(): DeckEstimate {
  return {
    resolution: null,
    hasTrack: false,
    playing: false,
    anchorPosSeconds: 0,
    anchorAtNs: 0n,
    rate: 1,
    cuePointSeconds: 0,
    tempoFader: 0.5,
    channelFader: null,
    filter: null,
    loopActive: false,
    loopStartBeat: null,
    loopBeatLength: null,
    sync: null,
    rollActive: false,
    rollBeats: null,
    lastHotCue: null,
    pendingLoadAtNs: null,
    locked: false,
    confidence: 0,
    lastEventAtNs: null,
    lastEmitted: null,
  };
}

export class CompositeProvider extends ProviderBase {
  private readonly mapper = new DeckGenerationMapper();
  private readonly decks = new Map<CompositeDeck, DeckEstimate>([
    [1, emptyDeck()],
    [2, emptyDeck()],
  ]);
  private readonly capabilities: ProviderCapabilities = {
    master: true,
    loop: true,
    pitch: true,
    sync: true,
    hotCue: true,
    roll: true,
  };
  private readonly listOpenFiles: OpenFilesLister | null;
  private readonly resolveTrack: CompositeTrackResolver | null;
  private readonly libraryRoots: readonly string[];
  private readonly linkTempo: () => CompositeLinkTempo | null;
  private tempoRangePercent: number;
  private readonly envelopeRateHz: number;
  private readonly correlationWindowMs: number;
  private readonly lockThresholdMs: number;
  private readonly minLockConfidence: number;
  private readonly maxCorrectionMsPerTick: number;
  private readonly eventTimeoutMs: number;
  private readonly jogSecondsPerUnit: number;
  private readonly audioRing = new Array<number>();
  private readonly audioCap: number;
  private crossfader: number | null = null;
  private midiUnavailable: { reason: string; remedy: string } | null = null;
  private malformedCount = 0;

  constructor(opts: CompositeProviderOptions = {}) {
    super(COMPOSITE_PROVIDER_ID, "rekordbox", opts.now);
    this.listOpenFiles = opts.listOpenFiles ?? null;
    this.resolveTrack = opts.resolveTrack ?? null;
    this.libraryRoots = opts.libraryRoots ?? [];
    this.linkTempo = opts.linkTempo ?? (() => null);
    this.tempoRangePercent = opts.tempoRangePercent ?? COMPOSITE_DEFAULTS.tempoRangePercent;
    this.envelopeRateHz = opts.envelopeRateHz ?? COMPOSITE_DEFAULTS.envelopeRateHz;
    this.correlationWindowMs = opts.correlationWindowMs ?? COMPOSITE_DEFAULTS.correlationWindowMs;
    this.lockThresholdMs = opts.lockThresholdMs ?? COMPOSITE_DEFAULTS.lockThresholdMs;
    this.minLockConfidence = opts.minLockConfidence ?? COMPOSITE_DEFAULTS.minLockConfidence;
    this.maxCorrectionMsPerTick =
      opts.maxCorrectionMsPerTick ?? COMPOSITE_DEFAULTS.maxCorrectionMsPerTick;
    this.eventTimeoutMs = opts.eventTimeoutMs ?? COMPOSITE_DEFAULTS.eventTimeoutMs;
    this.jogSecondsPerUnit = opts.jogSecondsPerUnit ?? COMPOSITE_DEFAULTS.jogSecondsPerUnit;
    this.audioCap = Math.max(64, this.envelopeRateHz * 16);
  }

  protected async onStart(): Promise<void> {
    if (this.midiUnavailable) {
      this.setStatus({
        state: "unavailable",
        reason: this.midiUnavailable.reason,
        remedy: this.midiUnavailable.remedy,
      });
      return;
    }
    this.setStatus({ state: "starting" });
  }

  getCapabilities(): ProviderCapabilities {
    return this.capabilities;
  }

  getDecks(): readonly ProviderDeckState[] {
    return [...this.decks.values()]
      .map((deck) => deck.lastEmitted)
      .filter((state): state is ProviderDeckState => state !== null);
  }

  setTempoRangePercent(range: number): void {
    if (range > 0 && range <= 100) this.tempoRangePercent = range;
  }

  reportMidiUnavailable(reason: string, remedy: string): void {
    this.midiUnavailable = { reason, remedy };
    this.setStatus({ state: "unavailable", reason, remedy });
  }

  reportMidiAvailable(): void {
    this.midiUnavailable = null;
    this.setStatus({ state: "starting" });
  }

  malformedCounted(): number {
    return this.malformedCount;
  }

  // Malformed transport input (garbage MIDI bytes from the feed) is rejected
  // and counted, never thrown into the manager.
  ingestMalformed(reason = "malformed controller input"): void {
    this.malformedCount += 1;
    this.markRejected(reason);
  }

  // Push loopback onset-envelope frames (frames per second = envelopeRateHz).
  pushAudio(samples: readonly number[]): void {
    for (const sample of samples) this.audioRing.push(sample);
    while (this.audioRing.length > this.audioCap) {
      this.audioRing.splice(0, this.audioRing.length - this.audioCap);
    }
  }

  audioDepth(): number {
    return this.audioRing.length;
  }

  ingestControllerEvent(event: CompositeControllerEvent): void {
    if (event.control === "crossfader") {
      this.crossfader = clamp01(event.value);
      this.touch(event.atNs);
      return;
    }
    const deck = this.decks.get(event.deck as CompositeDeck);
    if (!deck) {
      this.ingestMalformed(`controller event for unknown deck ${event.deck}`);
      return;
    }
    deck.lastEventAtNs = event.atNs;
    switch (event.control) {
      case "play":
        if (event.value >= 1) {
          if (!deck.playing) {
            deck.anchorAtNs = event.atNs;
            deck.playing = true;
          }
        } else {
          deck.anchorPosSeconds = this.positionAt(deck, event.atNs);
          deck.anchorAtNs = event.atNs;
          deck.playing = false;
        }
        break;
      case "cue":
        if (event.value >= 1) {
          if (deck.playing) {
            deck.playing = false;
            deck.anchorPosSeconds = deck.cuePointSeconds;
            deck.anchorAtNs = event.atNs;
          } else {
            deck.cuePointSeconds = this.positionAt(deck, event.atNs);
          }
        }
        break;
      case "sync":
        if (event.value >= 1) deck.sync = !(deck.sync ?? false);
        break;
      case "load":
        if (event.value >= 1) {
          // LOAD is unload-then-load: the old generation ends now, the
          // resolved track opens a new one on the next open-file poll.
          deck.pendingLoadAtNs = event.atNs;
          this.unloadDeck(event.deck as CompositeDeck, event.atNs);
        }
        break;
      case "hotcue":
        if (event.value >= 1 && event.pad !== null) {
          deck.lastHotCue = { number: event.pad, atNs: event.atNs };
        }
        break;
      case "loop-in":
        if (event.value >= 1) {
          deck.loopActive = true;
          deck.loopStartBeat = this.beatAt(deck, event.atNs);
          deck.loopBeatLength = null;
        }
        break;
      case "loop-out":
        if (event.value >= 1 && deck.loopActive) {
          const end = this.beatAt(deck, event.atNs);
          deck.loopBeatLength =
            deck.loopStartBeat !== null && end !== null && end > deck.loopStartBeat
              ? end - deck.loopStartBeat
              : null;
        }
        break;
      case "loop-exit":
        if (event.value >= 1) {
          deck.loopActive = false;
          deck.loopStartBeat = null;
          deck.loopBeatLength = null;
        }
        break;
      case "loop-halve":
        if (event.value >= 1 && deck.loopBeatLength !== null) {
          deck.loopBeatLength = deck.loopBeatLength / 2;
        }
        break;
      case "loop-double":
        if (event.value >= 1 && deck.loopBeatLength !== null) {
          deck.loopBeatLength = deck.loopBeatLength * 2;
        }
        break;
      case "pad-roll":
        deck.rollActive = event.value >= 1;
        break;
      case "jog-touch":
        break;
      case "jog-move":
        deck.anchorPosSeconds = this.positionAt(deck, event.atNs) + event.value * this.jogSecondsPerUnit;
        deck.anchorAtNs = event.atNs;
        deck.locked = false;
        break;
      case "channel-fader":
        deck.channelFader = clamp01(event.value);
        break;
      case "filter":
        deck.filter = clamp01(event.value);
        break;
      case "tempo":
        deck.tempoFader = clamp01(event.value);
        deck.rate = this.rateFor(clamp01(event.value));
        deck.anchorPosSeconds = this.positionAt(deck, event.atNs);
        deck.anchorAtNs = event.atNs;
        deck.locked = false;
        break;
    }
    this.touch(event.atNs);
    this.emit(this.stateFor(event.deck as CompositeDeck, event.atNs));
  }

  // Correlate pending LOAD presses with the process open files. The host
  // calls this at `live.composite.openFilePollMs`; tests call it by hand.
  pollOpenFiles(atNs?: bigint): void {
    const at = atNs ?? this.now();
    if (!this.listOpenFiles || !this.resolveTrack) return;
    let candidates: string[];
    try {
      candidates = matchLibraryAudio(this.listOpenFiles(), this.libraryRoots);
    } catch {
      this.markRejected("open-file poll failed");
      return;
    }
    const assigned = new Set<string>();
    for (const deck of [1, 2] as const) {
      const state = this.decks.get(deck);
      if (!state || state.pendingLoadAtNs === null) continue;
      const pick = candidates.find((path) => !assigned.has(path)) ?? null;
      state.pendingLoadAtNs = null;
      if (pick === null) {
        state.resolution = null;
        state.hasTrack = true;
        state.anchorPosSeconds = 0;
        state.anchorAtNs = at;
        state.cuePointSeconds = 0;
        state.locked = false;
        state.confidence = 0;
        this.emit(this.stateFor(deck, at, { id: `unresolved:${deck}:${String(at)}` }));
        continue;
      }
      assigned.add(pick);
      const resolution = this.resolveTrack(deck, {
        path: pick,
        title: null,
        artist: null,
        bpm: null,
        durationSeconds: null,
      });
      state.resolution = resolution;
      state.hasTrack = true;
      state.anchorPosSeconds = 0;
      state.anchorAtNs = at;
      state.cuePointSeconds = 0;
      state.locked = false;
      state.confidence = 0;
      this.emit(this.stateFor(deck, at));
    }
    this.touch(at);
  }

  // Re-estimate every loaded deck at the current clock, apply audio timing
  // correction where envelopes allow, and re-emit. The contract suite and
  // the fusion staleness path drive this instead of wall-clock timers.
  tick(atNs?: bigint): void {
    const at = atNs ?? this.now();
    this.correctByAudio(at);
    for (const deck of [1, 2] as const) {
      const state = this.decks.get(deck);
      if (state && (state.hasTrack || state.lastEmitted !== null)) {
        this.emit(this.stateFor(deck, at));
      }
    }
    this.touch(at);
  }

  private correctByAudio(at: bigint): void {
    const correctable = [1, 2].filter((deck) => {
      const state = this.decks.get(deck as CompositeDeck);
      return (
        state !== undefined &&
        state.hasTrack &&
        state.resolution?.onsetEnvelope !== undefined &&
        state.resolution?.onsetEnvelope !== null &&
        state.playing
      );
    }) as CompositeDeck[];
    if (correctable.length === 0 || this.audioRing.length === 0) return;
    const windowSamples = Math.max(
      8,
      Math.round((this.correlationWindowMs / 1000) * this.envelopeRateHz),
    );
    const raw = this.audioRing.slice(-Math.min(this.audioRing.length, windowSamples * 2));
    if (correctable.length === 1) {
      const deck = correctable[0] as CompositeDeck;
      const envelope = this.decks.get(deck)?.resolution?.onsetEnvelope ?? [];
      const ref = this.referenceWindow(deck, envelope, Math.min(raw.length, windowSamples), at);
      const live = raw.slice(-ref.length);
      this.correctDeck(deck, live, ref, 1, at);
      return;
    }
    // Two decks audible: correlate against the fader-weighted mix and
    // attribute the correction to the louder deck.
    const weights = correctable.map((deck) => this.audibleWeight(deck));
    if (weights.every((w) => w <= 0)) return;
    const refs = correctable.map((deck) => {
      const env = this.decks.get(deck)?.resolution?.onsetEnvelope ?? [];
      return this.referenceWindow(deck, env, Math.min(raw.length, windowSamples), at);
    });
    const mixed = mixReferences(refs, weights);
    const live = raw.slice(-mixed.length);
    let loudest = correctable[0] as CompositeDeck;
    let loudestWeight = -1;
    correctable.forEach((deck, i) => {
      if ((weights[i] ?? 0) > loudestWeight) {
        loudestWeight = weights[i] ?? 0;
        loudest = deck;
      }
    });
    this.correctDeck(loudest, live, mixed, loudestWeight, at);
  }

  private correctDeck(
    deck: CompositeDeck,
    live: readonly number[],
    ref: readonly number[],
    weight: number,
    at: bigint,
  ): void {
    const state = this.decks.get(deck);
    if (!state) return;
    const maxLag = Math.max(1, Math.min(6, Math.round((this.correlationWindowMs / 1000) * this.envelopeRateHz)));
    const { lagSamples, confidence } = correlateEnvelopes(live, ref, maxLag);
    const scaled = confidence * Math.min(1, weight > 0 ? weight : 1);
    state.confidence = scaled;
    const offsetMs = (-lagSamples / this.envelopeRateHz) * 1000;
    if (scaled < this.minLockConfidence || Math.abs(offsetMs) < 0.5) {
      state.locked = scaled >= this.minLockConfidence && Math.abs(offsetMs) <= this.lockThresholdMs;
      return;
    }
    const cappedMs = Math.max(
      -this.maxCorrectionMsPerTick,
      Math.min(this.maxCorrectionMsPerTick, offsetMs),
    );
    const corrected = this.positionAt(state, at) + cappedMs / 1000;
    state.anchorPosSeconds = Math.max(0, corrected);
    state.anchorAtNs = at;
    state.locked = Math.abs(offsetMs) <= this.lockThresholdMs;
  }

  private referenceWindow(
    deck: CompositeDeck,
    envelope: readonly number[],
    length: number,
    atNs: bigint,
  ): readonly number[] {
    const state = this.decks.get(deck);
    if (!state || envelope.length === 0) return [];
    const end = Math.round(this.positionAt(state, atNs) * this.envelopeRateHz);
    const start = Math.max(0, end - length);
    return envelope.slice(start, start + length);
  }

  private audibleWeight(deck: CompositeDeck): number {
    const state = this.decks.get(deck);
    if (!state || !state.playing) return 0;
    const channel = state.channelFader ?? 1;
    const cross = this.crossfader ?? 0.5;
    const gain = deck === 1 ? (1 - cross) : cross;
    return channel * gain;
  }

  private unloadDeck(deck: CompositeDeck, atNs: bigint): void {
    const state = this.decks.get(deck);
    if (!state) return;
    state.resolution = null;
    state.hasTrack = false;
    state.playing = false;
    state.anchorPosSeconds = 0;
    state.anchorAtNs = atNs;
    state.cuePointSeconds = 0;
    state.locked = false;
    state.confidence = 0;
    this.emit(this.stateFor(deck, atNs));
  }

  private positionAt(deck: DeckEstimate, atNs: bigint): number {
    if (!deck.playing) return deck.anchorPosSeconds;
    const elapsed = Number(atNs - deck.anchorAtNs) / 1e9;
    return Math.max(0, deck.anchorPosSeconds + Math.max(0, elapsed) * deck.rate);
  }

  private rateFor(tempoFader: number): number {
    return 1 + (tempoFader - 0.5) * 2 * (this.tempoRangePercent / 100);
  }

  private beatAt(deck: DeckEstimate, atNs: bigint): number | null {
    const grid = deck.resolution?.grid;
    if (!grid) return null;
    return gridBeatAt(grid, this.positionAt(deck, atNs));
  }

  private effectiveBpmFor(deck: DeckEstimate, atNs: bigint): number | null {
    const grid = deck.resolution?.grid;
    const pos = this.positionAt(deck, atNs);
    const gridBpm = grid ? gridBpmAt(grid, pos) : null;
    const link = this.linkTempo();
    if (link && Number(atNs - link.atNs) / 1e6 < 2000) return link.bpm;
    if (gridBpm !== null) return gridBpm * deck.rate;
    return null;
  }

  private stateFor(deckId: CompositeDeck, atNs: bigint, forceTrack?: TrackHint): ProviderDeckState {
    const deck = this.decks.get(deckId);
    const fallback = deck ?? emptyDeck();
    const pos = this.positionAt(fallback, atNs);
    const grid = fallback.resolution?.grid ?? null;
    const beat = grid ? gridBeatAt(grid, pos) : null;
    const beatInBar =
      beat === null ? null : (((Math.floor(beat) % 4) + 4) % 4 + 1) as 1 | 2 | 3 | 4;
    const effectiveBpm = this.effectiveBpmFor(fallback, atNs);
    const track =
      forceTrack !== undefined
        ? toTrackLike(forceTrack)
        : fallback.resolution
          ? {
              id: fallback.resolution.id,
              ...(fallback.resolution.canonicalPath
                ? { canonicalPath: fallback.resolution.canonicalPath }
                : {}),
              ...(fallback.resolution.title ? { title: fallback.resolution.title } : {}),
              ...(fallback.resolution.artist ? { artist: fallback.resolution.artist } : {}),
            }
          : fallback.hasTrack
            ? { id: "unknown" }
            : null;
    const quality: Partial<Record<keyof ProviderDeckState, QualityLabel>> = {
      playing: "derived",
      playheadSeconds: fallback.locked ? "derived" : "estimated",
      beat: "derived",
      effectiveBpm: this.linkTempo() ? "derived" : "estimated",
      pitchPercent: "derived",
      channelFader: "exact",
      crossfader: "exact",
      master: "derived",
      sync: "derived",
      loopRoll: "estimated",
      lastHotCue: "derived",
    };
    const state = this.mapper.update(this.id, {
      deckId,
      atNs,
      playing: fallback.playing,
      playheadSeconds: pos,
      playRate: fallback.rate,
      effectiveBpm,
      track,
      beat,
      beatInBar,
      pitchPercent: (fallback.rate - 1) * 100,
      sync: fallback.sync,
      loopRoll:
        fallback.loopActive || fallback.rollActive
          ? {
              active: true,
              beatLength: fallback.loopBeatLength ?? fallback.rollBeats,
            }
          : null,
      hotCue: fallback.lastHotCue,
      channelFader: fallback.channelFader,
      crossfader: this.crossfader,
      master: this.masterFor(deckId),
      quality,
    });
    if (deck) deck.lastEmitted = state;
    return state;
  }

  private masterFor(deckId: CompositeDeck): boolean | null {
    const a = this.audibleWeight(1);
    const b = this.audibleWeight(2);
    if (a <= 0 && b <= 0) return null;
    return deckId === 1 ? a >= b : b > a;
  }

  private touch(atNs: bigint): void {
    if (this.midiUnavailable) return;
    const ages = [1, 2].map((deck) => {
      const last = this.decks.get(deck as CompositeDeck)?.lastEventAtNs;
      return last === null || last === undefined ? null : Number(atNs - last) / 1e6;
    });
    const latest = ages.filter((age): age is number => age !== null);
    if (latest.length === 0) {
      if (this.getStatus().state === "starting") return;
    }
    const ageMs = latest.length === 0 ? 0 : Math.min(...latest);
    if (ageMs > this.eventTimeoutMs) {
      this.setStatus({ state: "degraded", reason: "no FLX4 input", updateHz: 0, ageMs });
      return;
    }
    const updateHz = this.envelopeRateHz > 0 ? 60 : 0;
    this.setStatus({ state: "live", updateHz, ageMs });
  }
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function toTrackLike(hint: TrackHint): { id: string; title?: string; artist?: string } {
  const out: { id: string; title?: string; artist?: string } = { id: hint.id ?? "unknown" };
  if (hint.title) out.title = hint.title;
  if (hint.artist) out.artist = hint.artist;
  return out;
}
