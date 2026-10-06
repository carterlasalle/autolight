// rkbx_link OSC provider (`rkbx-osc`, T-LIVE-03, F-LIVE-03).
//
// rkbx_link is a separately installed GPL-3.0 sidecar: never bundled, never
// re-signed by this app and never run with elevated privileges by the app.
// This provider only consumes its OSC output on loopback UDP
// (live.rkbx.oscBind, default 127.0.0.1:4460), mapping the documented
// addresses to per-deck state:
//   /<deck>/time            seconds, sample-accurate at the source
//   /<deck>/bpm/current     effective BPM
//   /<deck>/bpm/original    track BPM, so playRate = current / original
//   /<deck>/track/title|artist|album   text for library resolution (T-RBL-07)
//   /<deck>/phrase/current|next|countin
//   /<deck>/beat/subdiv/<x> beat phase cross-check
//   /master/...             messages for whichever deck is master
// <deck> is `master` or 1 to 4. Addresses the provider does not know are kept
// under `raw` and counted, never dropped silently.
//
// Playing is inferred from time advancing (live.rkbx.playingEpsilonMs,
// live.rkbx.pauseHoldMs); a jump larger than runtime.seek.thresholdMs emits a
// seek event. Quality: playheadSeconds exact, playing derived, beat derived.
import { createSocket, type Socket } from "node:dgram";
import { axFractionalBeat } from "./ax.js";
import { decodeOscDatagram, encodeOscMessage, type OscArgument, type OscMessage } from "./osc.js";
import { parseRkbxAddress } from "./follow.js";
import {
  DeckGenerationMapper,
  ProviderBase,
  type ClockFn,
  type PhraseInfo,
  type ProviderCapabilities,
  type ProviderDeckState,
  type QualityLabel,
} from "./providers.js";

export interface RkbxOscOptions {
  now?: ClockFn;
  /** Loopback bind for the listener; null ingests datagrams without a socket. */
  bind?: string | null;
  playingEpsilonMs?: number;
  pauseHoldMs?: number;
  seekThresholdMs?: number;
  grids?: Readonly<Record<number, readonly { sourceTimeMs: number }[]>>;
}

export interface RkbxSeekEvent {
  deckId: number;
  fromSeconds: number;
  toSeconds: number;
  atNs: bigint;
}

export interface RkbxResolutionRequest {
  deckId: number;
  title: string | null;
  artist: string | null;
  album: string | null;
  effectiveBpm: number | null;
  durationSeconds: number | null;
  atNs: bigint;
}

interface DeckBuffer {
  playheadSeconds: number;
  previousAtNs: bigint | null;
  playing: boolean;
  pauseSinceNs: bigint | null;
  bpmCurrent: number | null;
  bpmOriginal: number | null;
  title: string | null;
  artist: string | null;
  album: string | null;
  phrase: PhraseInfo;
  beatSubdiv: number | null;
  lastBeatAtNs: bigint | null;
  masterFlag: boolean | null;
  durationSeconds: number | null;
  unknownAddresses: string[];
}

function emptyBuffer(): DeckBuffer {
  return {
    playheadSeconds: 0,
    previousAtNs: null,
    playing: false,
    pauseSinceNs: null,
    bpmCurrent: null,
    bpmOriginal: null,
    title: null,
    artist: null,
    album: null,
    phrase: { current: null, next: null, countInBeats: null },
    beatSubdiv: null,
    lastBeatAtNs: null,
    masterFlag: null,
    durationSeconds: null,
    unknownAddresses: [],
  };
}

export class RkbxOscProvider extends ProviderBase {
  private readonly buffers = new Map<number | "master", DeckBuffer>();
  private readonly mapper = new DeckGenerationMapper();
  private readonly capabilities: ProviderCapabilities = {
    master: true, loop: false, pitch: true, sync: false, hotCue: false, roll: false,
  };
  private readonly options: Required<Omit<RkbxOscOptions, "bind" | "now">> & { bind: string | null };
  private readonly seekEvents: RkbxSeekEvent[] = [];
  private readonly resolutionRequests: RkbxResolutionRequest[] = [];
  private readonly messageTimes: number[] = [];
  private socket: Socket | null = null;
  private masterDeckId: number | null = null;
  private lastAddress: string | null = null;

  constructor(opts: RkbxOscOptions = {}) {
    super("rkbx-osc", "rekordbox", opts.now);
    this.options = {
      bind: opts.bind ?? null,
      playingEpsilonMs: opts.playingEpsilonMs ?? 5,
      pauseHoldMs: opts.pauseHoldMs ?? 150,
      seekThresholdMs: opts.seekThresholdMs ?? 150,
      grids: opts.grids ?? {},
    };
  }

  protected async onStart(): Promise<void> {
    this.setStatus({ state: "starting" });
    if (this.options.bind === null) return;
    const [host, port] = splitHostPort(this.options.bind);
    const socket = createSocket({ type: "udp4", reuseAddr: true });
    this.socket = socket;
    socket.on("message", (msg: Buffer) => this.ingestDatagram(new Uint8Array(msg)));
    socket.on("error", (err: Error) => {
      // Socket errors are provider status, never swallowed (S5).
      this.setStatus({ state: "failed", error: `osc socket: ${err.message}` });
    });
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const onError = (err: Error): void => reject(err);
    socket.once("error", onError);
    socket.bind(port, host, () => {
      socket.off("error", onError);
      this.setStatus({ state: "live", updateHz: 0, ageMs: 0 });
      resolve();
    });
    await promise.catch((err: unknown) => {
      this.setStatus({ state: "failed", error: `osc bind ${this.options.bind ?? ""}: ${err instanceof Error ? err.message : String(err)}` });
      throw err;
    });
  }

  protected async onStop(): Promise<void> {
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    const { promise, resolve } = Promise.withResolvers<void>();
    socket.close(() => resolve());
    await promise;
  }

  getCapabilities(): ProviderCapabilities {
    return this.capabilities;
  }

  getDecks(): readonly ProviderDeckState[] {
    return [...this.buffers.keys()]
      .filter((deck): deck is number => typeof deck === "number")
      .sort((a, b) => a - b)
      .map((deck) => this.stateFor(deck));
  }

  get boundPort(): number | null {
    const address = this.socket?.address();
    return address && typeof address === "object" ? address.port : null;
  }

  get lastSeenAddress(): string | null {
    return this.lastAddress;
  }

  getMasterDeckId(): number | null {
    return this.masterDeckId;
  }

  drainSeekEvents(): RkbxSeekEvent[] {
    return this.seekEvents.splice(0, this.seekEvents.length);
  }

  drainResolutionRequests(): RkbxResolutionRequest[] {
    return this.resolutionRequests.splice(0, this.resolutionRequests.length);
  }

  ingestDatagram(bytes: Uint8Array, atNs?: bigint): void {
    const at = atNs ?? this.now();
    const decoded = decodeOscDatagram(bytes);
    if (decoded.malformed.length > 0) {
      this.markRejected(`malformed OSC datagram: ${decoded.malformed[0] ?? "unknown"}`);
      return;
    }
    this.messageTimes.push(Number(at / 1_000_000n));
    if (this.messageTimes.length > 128) this.messageTimes.splice(0, this.messageTimes.length - 128);
    const touched = new Set<number>();
    for (const message of decoded.messages) {
      const deck = this.applyMessage(message, at);
      if (typeof deck === "number") touched.add(deck);
    }
    this.setStatus({ state: "live", updateHz: this.updateHz(), ageMs: 0 });
    for (const deck of touched) this.emit(this.stateFor(deck));
  }

  private updateHz(): number {
    const times = this.messageTimes;
    if (times.length < 2) return 0;
    const spanMs = (times.at(-1) ?? 0) - (times[0] ?? 0);
    if (spanMs <= 0) return 0;
    return ((times.length - 1) * 1000) / spanMs;
  }

  private bufferFor(deck: number | "master"): DeckBuffer {
    let buffer = this.buffers.get(deck);
    if (!buffer) {
      buffer = emptyBuffer();
      this.buffers.set(deck, buffer);
    }
    return buffer;
  }

  private applyMessage(message: OscMessage, atNs: bigint): number | "master" | null {
    const parsed = parseRkbxAddress(message.address);
    if (!parsed) return null;
    this.lastAddress = message.address;
    const buffer = this.bufferFor(parsed.deck);
    const value = message.args[0];
    if (parsed.subdiv !== null) {
      buffer.beatSubdiv = parsed.subdiv;
      buffer.lastBeatAtNs = atNs;
      return parsed.deck;
    }
    switch (parsed.path) {
      case "time": {
        const seconds = asNumber(value);
        if (seconds === null) return this.rejectValue(message.address);
        this.applyTime(buffer, seconds, atNs);
        if (parsed.deck === "master") this.resolveMaster();
        return parsed.deck;
      }
      case "bpm/current":
        buffer.bpmCurrent = asNumber(value);
        return parsed.deck;
      case "bpm/original":
        buffer.bpmOriginal = asNumber(value);
        return parsed.deck;
      case "track/title":
        buffer.title = asText(value);
        this.requestResolution(parsed.deck, atNs);
        return parsed.deck;
      case "track/artist":
        buffer.artist = asText(value);
        return parsed.deck;
      case "track/album":
        buffer.album = asText(value);
        return parsed.deck;
      case "track/duration":
        buffer.durationSeconds = asNumber(value);
        return parsed.deck;
      case "phrase/current":
        buffer.phrase = { ...buffer.phrase, current: asText(value) };
        return parsed.deck;
      case "phrase/next":
        buffer.phrase = { ...buffer.phrase, next: asText(value) };
        return parsed.deck;
      case "phrase/countin":
        buffer.phrase = { ...buffer.phrase, countInBeats: asNumber(value) };
        return parsed.deck;
      case "beat":
        buffer.lastBeatAtNs = atNs;
        return parsed.deck;
      case "playing":
      case "play":
        buffer.playing = typeof value === "number" ? value !== 0 : value === "true";
        return parsed.deck;
      default: {
        buffer.unknownAddresses.push(message.address);
        if (buffer.unknownAddresses.length > 32) buffer.unknownAddresses.shift();
        return parsed.deck;
      }
    }
  }

  private rejectValue(address: string): null {
    this.markRejected(`non-numeric value for ${address}`);
    return null;
  }

  // A seek is a playhead jump that the elapsed wall time cannot explain;
  // comparing against the wall clock keeps normal 120 Hz playback from
  // looking like a seek.
  private applyTime(buffer: DeckBuffer, seconds: number, atNs: bigint): void {
    const previous = buffer.playheadSeconds;
    const previousAt = buffer.previousAtNs;
    if (previousAt !== null) {
      const deltaMs = Math.abs(seconds - previous) * 1000;
      const forward = seconds > previous;
      if (forward && deltaMs >= this.options.playingEpsilonMs) {
        buffer.playing = true;
        buffer.pauseSinceNs = null;
      } else if (!forward && deltaMs >= this.options.playingEpsilonMs) {
        buffer.playing = false;
        buffer.pauseSinceNs = atNs;
      } else if (buffer.pauseSinceNs === null) {
        buffer.pauseSinceNs = atNs;
      } else if (Number(atNs - buffer.pauseSinceNs) / 1e6 >= this.options.pauseHoldMs) {
        buffer.playing = false;
      }
      const wallMs = Number(atNs - previousAt) / 1e6;
      const explainedMs = wallMs * this.playRate(buffer);
      // A pause (unchanged playhead) moves far less than the wall clock; only
      // an actual jump counts as a seek.
      if (deltaMs > this.options.seekThresholdMs && Math.abs(deltaMs - explainedMs) > this.options.seekThresholdMs) {
        this.seekEvents.push({ deckId: this.deckIdOf(buffer), fromSeconds: previous, toSeconds: seconds, atNs });
      }
    }
    buffer.previousAtNs = atNs;
    buffer.playheadSeconds = seconds;
  }

  private deckIdOf(buffer: DeckBuffer): number {
    for (const [deck, value] of this.buffers) {
      if (value === buffer && typeof deck === "number") return deck;
    }
    return 0;
  }

  private requestResolution(deck: number | "master", atNs: bigint): void {
    const buffer = this.bufferFor(deck);
    if (buffer.title === null) return;
    this.resolutionRequests.push({
      deckId: deck === "master" ? (this.masterDeckId ?? 0) : deck,
      title: buffer.title,
      artist: buffer.artist,
      album: buffer.album,
      effectiveBpm: buffer.bpmOriginal ?? buffer.bpmCurrent,
      durationSeconds: buffer.durationSeconds,
      atNs,
    });
  }

  // Which numbered deck the master messages belong to: the deck whose time
  // matches the master time. Without a match the master stays unassigned
  // rather than being invented.
  private resolveMaster(): void {
    const master = this.buffers.get("master");
    if (!master) return;
    let best: { deck: number; deltaMs: number } | null = null;
    for (const [deck, buffer] of this.buffers) {
      if (typeof deck !== "number") continue;
      const deltaMs = Math.abs(buffer.playheadSeconds - master.playheadSeconds) * 1000;
      if (best === null || deltaMs < best.deltaMs) best = { deck, deltaMs };
    }
    this.masterDeckId = best && best.deltaMs <= 250 ? best.deck : null;
    for (const deck of this.buffers.keys()) {
      if (typeof deck !== "number") continue;
      const buffer = this.bufferFor(deck);
      buffer.masterFlag = this.masterDeckId === null ? null : deck === this.masterDeckId;
      this.emit(this.stateFor(deck));
    }
  }

  private stateFor(deck: number): ProviderDeckState {
    const buffer = this.bufferFor(deck);
    const state = this.mapper.update(this.id, {
      deckId: deck,
      atNs: this.now(),
      playing: buffer.playing,
      playheadSeconds: buffer.playheadSeconds,
      playRate: this.playRate(buffer),
      effectiveBpm: buffer.bpmCurrent,
      track: {
        // Identity is the title: artist and album trickle in separately and
        // must not look like a new track.
        id: `rkbx:${buffer.title ?? "unknown"}`,
        ...(buffer.title ? { title: buffer.title } : {}),
        ...(buffer.artist ? { artist: buffer.artist } : {}),
      },
      phrase: buffer.phrase,
      master: buffer.masterFlag,
      beat: this.beatFor(deck, buffer),
      quality: this.qualityFor(buffer),
    });
    return {
      ...state,
      raw: { provider: "rkbx-osc", unknownAddresses: [...buffer.unknownAddresses] },
    };
  }

  private qualityFor(buffer: DeckBuffer): Partial<Record<keyof ProviderDeckState, QualityLabel>> {
    return {
      playheadSeconds: "exact",
      playing: "derived",
      beat: "derived",
      effectiveBpm: buffer.bpmCurrent === null ? "estimated" : "exact",
      playRate: "derived",
      phrase: "exact",
    };
  }

  private playRate(buffer: DeckBuffer): number {
    if (buffer.bpmCurrent === null || buffer.bpmOriginal === null || buffer.bpmOriginal === 0) return 1;
    return buffer.bpmCurrent / buffer.bpmOriginal;
  }

  private beatFor(deck: number, buffer: DeckBuffer): number | null {
    const grid = this.options.grids[deck];
    if (!grid || grid.length === 0) return null;
    return axFractionalBeat(buffer.playheadSeconds, grid);
  }
}

function splitHostPort(bind: string): [string, number] {
  const at = bind.lastIndexOf(":");
  const host = at === -1 ? "127.0.0.1" : bind.slice(0, at);
  const port = at === -1 ? Number(bind) : Number(bind.slice(at + 1));
  return [host.length > 0 ? host : "127.0.0.1", Number.isFinite(port) ? port : 0];
}

function asNumber(value: OscArgument | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asText(value: OscArgument | undefined): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return null;
}

// Scripted deck timeline for tests and Simulator mode: play, pause, seek,
// loop, pitch, track change and master change, emitted at 60 or 120 Hz as the
// documented addresses over a real UDP socket.
export interface RkbxTimelineStep {
  atMs: number;
  action: "play" | "pause" | "seek" | "loop" | "pitch" | "track" | "master";
  seekToSeconds?: number;
  bpm?: number;
  title?: string;
  artist?: string;
}

export interface RkbxTimeline {
  deck: number;
  fromSeconds: number;
  bpm: number;
  hz?: number;
  durationMs: number;
  steps: readonly RkbxTimelineStep[];
}

export interface RkbxDatagram {
  atMs: number;
  bytes: Uint8Array;
}

// Deterministic datagram build: no sockets, so replay at any rate is exact.
export function buildRkbxDatagrams(timeline: RkbxTimeline): RkbxDatagram[] {
  const hz = timeline.hz ?? 120;
  const period = 1000 / hz;
  const out: RkbxDatagram[] = [];
  let seconds = timeline.fromSeconds;
  let bpm = timeline.bpm;
  let playing = false;
  let playRate = 1;
  const emit = (atMs: number, address: string, ...args: OscArgument[]): void => {
    out.push({ atMs, bytes: encodeOscMessage({ address, args }) });
  };
  emit(0, `/${timeline.deck}/bpm/original`, timeline.bpm);
  for (let atMs = 0; atMs <= timeline.durationMs; atMs += period) {
    for (const step of timeline.steps) {
      if (step.atMs > atMs || step.atMs < atMs - period) continue;
      if (step.action === "play") playing = true;
      if (step.action === "pause") playing = false;
      if (step.action === "seek" && step.seekToSeconds !== undefined) {
        seconds = step.seekToSeconds;
        emit(atMs, `/${timeline.deck}/time`, seconds);
      }
      if (step.action === "loop") {
        emit(atMs, `/${timeline.deck}/beat/subdiv/1`, 4);
      }
      if (step.action === "pitch" && step.bpm !== undefined) {
        playRate = step.bpm / timeline.bpm;
        bpm = step.bpm;
        emit(atMs, `/${timeline.deck}/bpm/current`, bpm);
      }
      if (step.action === "track") {
        if (step.title) emit(atMs, `/${timeline.deck}/track/title`, step.title);
        if (step.artist) emit(atMs, `/${timeline.deck}/track/artist`, step.artist);
      }
      if (step.action === "master") {
        emit(atMs, `/master/bpm/current`, bpm);
        emit(atMs, `/master/time`, seconds);
      }
    }
    if (playing) seconds += (period / 1000) * playRate;
    emit(atMs, `/${timeline.deck}/time`, Number(seconds.toFixed(4)));
  }
  return out;
}

// Real UDP send path used by the tests and by Simulator mode for any
// datagram stream (rkbx OSC here, PRO DJ LINK in the prolink tests).
export async function sendUdpDatagrams(datagrams: readonly RkbxDatagram[], target: string, onSent?: (index: number) => void): Promise<number> {
  const [host, port] = splitHostPort(target);
  const socket = createSocket("udp4");
  try {
    let sent = 0;
    for (const datagram of datagrams) {
      const { promise, resolve, reject } = Promise.withResolvers<void>();
      socket.send(Buffer.from(datagram.bytes), port, host, (err) => (err ? reject(err) : resolve()));
      await promise;
      onSent?.(sent);
      sent += 1;
    }
    return sent;
  } finally {
    const { promise: closed, resolve: onClosed } = Promise.withResolvers<void>();
    socket.close(() => onClosed());
    await closed;
  }
}
