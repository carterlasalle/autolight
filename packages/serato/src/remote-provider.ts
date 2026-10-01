// Serato Remote provider (T-SER-01, closes F-SER-01; spec 3.1, 6, 9.5).
//
// Spec 3.1 "Use directly, no duplicate implementation": the Bonjour
// `_SeratoIOSRemote._tcp` advertisement, the inbound TCP connection from
// Serato, OSC 1.1, the custom TCP delimiter (the 16-byte sentinel), the
// challenge and response handshake, deck metadata, playhead, play rate,
// effective BPM, autoloop and roll state, upfaders, crossfader, four decks and
// field coalescing on track change all live in `serato-connect`. The live path
// here subscribes to that client's typed events; nothing here reimplements the
// wire protocol.
//
// The same accumulator/state code also accepts already-decoded messages
// (`ingestFrame`), which is what the replay harness feeds so a capture decodes
// into exactly the states the live path produces. The loopback test in
// `capture.test.ts` drives both inputs with the same wire frames and asserts
// the two agree.
//
// Field notes:
// - `playing` is derived: the client's playhead carries (positionSeconds,
//   playRate, bpm), and playRate is 0 while stopped, so playing is
//   playRate !== 0. Labelled `derived`.
// - The track identity keeps the Remote filePath in `sourceIds.seratoPath`,
//   which is what T-ID-01 keys Serato identities on.
// - The protocol has no loop in/out positions, only the autoloop toggle and
//   the loop length in beats, so `loop.startSeconds` and `loop.endSeconds`
//   stay null while `beatLength` is real. Loop roll is its own field.
// - Serato does not report a master deck over this protocol, so `master` is
//   null here; inference with `serato.master.inferHoldMs` is T-SER-02.
// - `serato.remote.enabled` (default true) gates the provider at the call
//   site; `serato.master.inferHoldMs` (default 750) is read here so the
//   inference slice gets it from one place.
import {
  DeckGenerationMapper,
  ProviderBase,
  type ClockFn,
  type ProviderCapabilities,
  type ProviderDeckState,
  type TrackHint,
  type UpdateHint,
} from "@autolight/rekordbox-live";
import type { DeckState } from "@autolight/contracts";
import {
  FrameReader,
  NUM_REMOTE_DECKS,
  SeratoRemoteClient,
  type OscMessage,
  type SeratoRemoteDeckChangePayload,
  type SeratoRemoteLoopPayload,
  type SeratoRemoteMixerPayload,
  type SeratoRemotePeerInfo,
  type SeratoRemotePlayhead,
  type SeratoRemotePlayheadPayload,
  type SeratoRemoteReadyInfo,
} from "serato-connect";

/** Provider id used by the manager and by `live.provider` selection. */
export const SERATO_REMOTE_PROVIDER_ID = "serato-remote";
/** Config default for `serato.master.inferHoldMs` (unmeasured, wp09 section 4). */
export const SERATO_MASTER_INFER_HOLD_MS = 750;
/** A playhead sample older than this does not count toward the update rate. */
const RATE_WINDOW_MS = 2000;

export interface SeratoRemoteProviderOptions {
  now?: ClockFn;
  /** Bonjour instance name stem; peers see "<peerName> @ <hostname>". */
  peerName?: string;
  /** TCP port; 0 (default) lets the OS assign one. */
  port?: number;
  /** Bind address; the Remote peer connects in, so the LAN interface by default. */
  host?: string;
  /** `serato.master.inferHoldMs` passthrough for the inference slice. */
  masterInferHoldMs?: number;
  /** Test seam: a pre-built client (for example one already bound to a port). */
  client?: SeratoRemoteClient;
}

/**
 * Track fields as they arrive (one OSC message carries one field), so a field
 * is explicitly absent rather than "not mentioned": the accumulators merge
 * these patches, and `undefined` clears nothing.
 */
export interface SeratoTrackFields {
  title?: string | undefined;
  artist?: string | undefined;
  filePath?: string | undefined;
  valid?: boolean | undefined;
}

interface DeckAccumulator {
  track: SeratoTrackFields | null;
  playhead: SeratoRemotePlayhead | null;
  playheadAtNs: bigint | null;
  loop: { autoLoopOn?: boolean | undefined; beatLength?: number | undefined; loopRollOn?: boolean | undefined };
  upfader: number | null;
  playheadSamplesMs: number[];
}

function emptyAccumulator(): DeckAccumulator {
  return { track: null, playhead: null, playheadAtNs: null, loop: {}, upfader: null, playheadSamplesMs: [] };
}

/** A playhead sampled within this window of a track change belongs to the new track. */
const PLAYHEAD_KEEP_WINDOW_MS = 100;

export class SeratoRemoteProvider extends ProviderBase {
  private readonly mapper = new DeckGenerationMapper();
  private readonly decks = new Map<number, ProviderDeckState>();
  private readonly accumulators = new Map<number, DeckAccumulator>();
  private readonly capabilities: ProviderCapabilities = {
    master: false, loop: true, pitch: true, sync: false, hotCue: false, roll: true,
  };
  private readonly options: SeratoRemoteProviderOptions;
  private readonly frameReader = new FrameReader();
  readonly masterInferHoldMs: number;
  private client: SeratoRemoteClient | null = null;
  private detach: (() => void)[] = [];
  private advertised: SeratoRemoteReadyInfo | null = null;
  private peer: SeratoRemotePeerInfo | null = null;
  private crossfader: number | null = null;

  constructor(opts: SeratoRemoteProviderOptions = {}) {
    super(SERATO_REMOTE_PROVIDER_ID, "serato", opts.now);
    this.options = opts;
    this.masterInferHoldMs = opts.masterInferHoldMs ?? SERATO_MASTER_INFER_HOLD_MS;
  }

  protected override async onStart(): Promise<void> {
    if (this.client) return;
    this.setStatus({ state: "starting" });
    const client = this.options.client ?? new SeratoRemoteClient({
      peerName: this.options.peerName ?? "autolight",
      port: this.options.port ?? 0,
      host: this.options.host ?? "0.0.0.0",
    });
    this.client = client;
    this.attach(client);
    try {
      await client.start();
    } catch (err) {
      this.detachClient();
      const message = err instanceof Error ? err.message : String(err);
      this.setStatus({ state: "failed", error: message });
      throw err;
    }
    this.setStatus({ state: "live", updateHz: this.updateHz(), ageMs: 0 });
  }

  protected override async onStop(): Promise<void> {
    const client = this.client;
    this.detachClient();
    this.advertised = null;
    this.peer = null;
    this.crossfader = null;
    if (client) await client.stop();
  }

  getCapabilities(): ProviderCapabilities {
    return this.capabilities;
  }

  getDecks(): readonly ProviderDeckState[] {
    return [...this.decks.values()].sort((a, b) => a.deckId - b.deckId);
  }

  /** State of one deck, for tests and the setup assistant. */
  deck(deckId: number): DeckState | null {
    return this.decks.get(deckId) ?? null;
  }

  /** Advertisement, connection and authentication state the setup panel shows. */
  setupSnapshot(): {
    advertised: boolean;
    advertisedPort: number | null;
    instanceName: string | null;
    connected: boolean;
    authenticated: boolean;
    decks: { deckId: number; updateHz: number; trackLoaded: boolean }[];
  } {
    return {
      advertised: this.client !== null && this.advertised !== null,
      advertisedPort: this.advertised?.port ?? null,
      instanceName: this.advertised?.instanceName ?? null,
      connected: this.peer !== null,
      authenticated: this.peer?.peerName !== undefined,
      decks: Array.from({ length: NUM_REMOTE_DECKS }, (_, i) => i + 1).map((deckId) => ({
        deckId,
        updateHz: this.updateHzFor(deckId),
        trackLoaded: (this.accumulators.get(deckId)?.track?.filePath ?? "").length > 0,
      })),
    };
  }

  /** Malformed frames counted by the session (status moves to degraded). */
  getRejected(): number {
    return this.rejected;
  }

  /**
   * Feed one or more already-framed Remote frames (a whole track-load burst is
   * one call). Applies every message to the deck accumulators first, then
   * publishes one state per touched deck, so a burst produces a single
   * generation bump exactly like the live client's settled `deckChange`.
   */
  ingestFrame(bytes: Uint8Array, atNs?: bigint): ProviderDeckState[] {
    const at = atNs ?? this.now();
    let messages: OscMessage[];
    try {
      messages = this.frameReader.push(Buffer.from(bytes));
    } catch (err) {
      this.markRejected(err instanceof Error ? err.message : String(err));
      return [];
    }
    const touched = new Set<number>();
    let mixerTouched = false;
    for (const message of messages) {
      const deckId = this.applyStatusMessage(message, at);
      if (deckId === "mixer") mixerTouched = true;
      else if (deckId !== null) touched.add(deckId);
    }
    if (mixerTouched) for (let deckId = 1; deckId <= NUM_REMOTE_DECKS; deckId += 1) {
      if (this.accumulators.has(deckId)) touched.add(deckId);
    }
    const states = [...touched].sort((a, b) => a - b).map((deckId) => this.publish(deckId, at));
    if (states.length > 0) this.setStatus({ state: "live", updateHz: this.updateHz(), ageMs: 0 });
    return states;
  }

  /** Apply one decoded `/Status/...` message; returns the deck or "mixer". */
  applyStatusMessage(message: OscMessage, atNs: bigint): number | "mixer" | null {
    const { address, args } = message;
    if (address === "/Status/Video/Mixer/Crossfader") {
      const value = floatArg(args, 0);
      if (value === null) return null;
      this.crossfader = value;
      return "mixer";
    }
    const raw = intArg(args, 0);
    if (raw === null || raw < 0 || raw > NUM_REMOTE_DECKS) return null;
    const deckId = raw === NUM_REMOTE_DECKS ? NUM_REMOTE_DECKS : raw + 1;
    const acc = this.accumulatorFor(deckId);
    switch (address) {
      case "/Status/Deck/Song/Title":
        acc.track = { ...(acc.track ?? {}), title: stringArg(args, 1) ?? undefined };
        this.noteTrackFieldsChanged(deckId, atNs);
        return deckId;
      case "/Status/Deck/Song/Artist":
        acc.track = { ...(acc.track ?? {}), artist: stringArg(args, 1) ?? undefined };
        this.noteTrackFieldsChanged(deckId, atNs);
        return deckId;
      case "/Status/Deck/Song/Filepath":
        acc.track = { ...(acc.track ?? {}), filePath: stringArg(args, 1) ?? undefined };
        this.noteTrackFieldsChanged(deckId, atNs);
        return deckId;
      case "/Status/Deck/Song/Valid": {
        const valid = boolArg(args, 1);
        // An invalid song is an eject: the client drops the deck's track, so
        // the file path must not linger into the next generation.
        acc.track = valid === false ? { valid: false } : { ...(acc.track ?? {}), valid };
        this.noteTrackFieldsChanged(deckId, atNs);
        return deckId;
      }
      case "/Status/Deck/Playhead": {
        const position = floatArg(args, 1);
        const rate = floatArg(args, 2);
        const bpm = floatArg(args, 3);
        if (position === null || rate === null || bpm === null) return null;
        acc.playhead = { positionSeconds: position, playRate: rate, bpm, raw: [position, rate, bpm] };
        acc.playheadAtNs = atNs;
        const atMs = Number(atNs / 1_000_000n);
        acc.playheadSamplesMs = [...acc.playheadSamplesMs.filter((t) => atMs - t <= RATE_WINDOW_MS), atMs];
        return deckId;
      }
      case "/Status/Deck/Loop/AutoLoopOn":
        acc.loop = { ...acc.loop, autoLoopOn: boolArg(args, 1) };
        return deckId;
      case "/Status/Deck/Loop/BeatLength":
        acc.loop = { ...acc.loop, beatLength: floatArg(args, 1) ?? undefined };
        return deckId;
      case "/Status/Deck/Loop/LoopRollOn":
        acc.loop = { ...acc.loop, loopRollOn: boolArg(args, 1) };
        return deckId;
      case "/Status/Video/Deck/Mixer/Upfader": {
        const value = floatArg(args, 1);
        if (value === null) return null;
        acc.upfader = value;
        return deckId;
      }
      default:
        return null;
    }
  }

  private attach(client: SeratoRemoteClient): void {
    const onReady = (info: SeratoRemoteReadyInfo): void => {
      this.advertised = info;
      this.setStatus({ state: "live", updateHz: this.updateHz(), ageMs: 0 });
    };
    const onPeer = (info: SeratoRemotePeerInfo): void => {
      this.peer = info;
    };
    const onPeerDisconnected = (): void => {
      this.peer = null;
    };
    const onDeckChange = (payload: SeratoRemoteDeckChangePayload): void => {
      this.accumulatorFor(payload.deckId).track = payload.track;
      this.noteTrackFieldsChanged(payload.deckId, this.now());
      this.publish(payload.deckId, this.now());
    };
    const onPlayhead = (payload: SeratoRemotePlayheadPayload): void => {
      const acc = this.accumulatorFor(payload.deckId);
      acc.playhead = payload.playhead;
      acc.playheadAtNs = this.now();
      const atMs = Number(this.now() / 1_000_000n);
      acc.playheadSamplesMs = [...acc.playheadSamplesMs.filter((t) => atMs - t <= RATE_WINDOW_MS), atMs];
      this.publish(payload.deckId, this.now());
    };
    const onLoop = (payload: SeratoRemoteLoopPayload): void => {
      this.accumulatorFor(payload.deckId).loop = { ...payload.loop };
      this.publish(payload.deckId, this.now());
    };
    const onMixer = (payload: SeratoRemoteMixerPayload): void => {
      if (payload.mixer.crossfader !== undefined) this.crossfader = payload.mixer.crossfader;
      for (let deckId = 1; deckId <= NUM_REMOTE_DECKS; deckId += 1) {
        const value = payload.mixer.upfaders[deckId];
        if (value !== undefined) this.accumulatorFor(deckId).upfader = value;
      }
      for (let deckId = 1; deckId <= NUM_REMOTE_DECKS; deckId += 1) {
        if (this.accumulators.has(deckId)) this.publish(deckId, this.now());
      }
    };
    const onError = (err: Error): void => {
      // A malformed frame or a peer error moves the provider to degraded and is
      // counted; it never reaches the manager as a throw (S5, S26).
      this.markRejected(err.message);
    };
    client.on("ready", onReady);
    client.on("peerConnected", onPeer);
    client.on("paired", onPeer);
    client.on("peerDisconnected", onPeerDisconnected);
    client.on("deckChange", onDeckChange);
    client.on("playhead", onPlayhead);
    client.on("loopChange", onLoop);
    client.on("mixerChange", onMixer);
    client.on("error", onError);
    this.detach = [
      () => client.off("ready", onReady),
      () => client.off("peerConnected", onPeer),
      () => client.off("paired", onPeer),
      () => client.off("peerDisconnected", onPeerDisconnected),
      () => client.off("deckChange", onDeckChange),
      () => client.off("playhead", onPlayhead),
      () => client.off("loopChange", onLoop),
      () => client.off("mixerChange", onMixer),
      () => client.off("error", onError),
    ];
  }

  private detachClient(): void {
    for (const off of this.detach.splice(0)) off();
    this.client = null;
  }

  private accumulatorFor(deckId: number): DeckAccumulator {
    let acc = this.accumulators.get(deckId);
    if (!acc) {
      acc = emptyAccumulator();
      this.accumulators.set(deckId, acc);
    }
    return acc;
  }

  /**
   * Field coalescing on track change (§120 item 14, spec 3.1): the previous
   * track's loop, roll and playhead are cleared, and only values asserted
   * after the change survive. A playhead sampled within
   * PLAYHEAD_KEEP_WINDOW_MS of a load belongs to the new track and is kept;
   * an eject (no new track) clears everything track-scoped. The live client
   * calls this when its settled `deckChange` fires; the message path calls it
   * as soon as the identity changes, so the same burst can re-assert the new
   * track's values.
   */
  private noteTrackFieldsChanged(deckId: number, atNs: bigint): void {
    const acc = this.accumulatorFor(deckId);
    const nextId = this.trackHint(acc)?.id ?? null;
    const publishedId = this.decks.get(deckId)?.track?.id ?? null;
    if (nextId === publishedId) return;
    if (publishedId === null && nextId === null) return;
    const acc2 = this.accumulatorFor(deckId);
    const keepFreshPlayhead = nextId !== null
      && acc2.playheadAtNs !== null
      && Number(atNs - acc2.playheadAtNs) / 1e6 <= PLAYHEAD_KEEP_WINDOW_MS;
    this.accumulators.set(deckId, {
      ...acc2,
      loop: {},
      playhead: keepFreshPlayhead ? acc2.playhead : null,
      playheadSamplesMs: keepFreshPlayhead ? acc2.playheadSamplesMs : [],
    });
  }

  private publish(deckId: number, atNs: bigint): ProviderDeckState {
    const acc = this.accumulatorFor(deckId);
    const playhead = acc.playhead;
    const hint: UpdateHint = {
      deckId,
      atNs,
      playing: (playhead?.playRate ?? 0) !== 0,
      playheadSeconds: playhead?.positionSeconds ?? 0,
      playRate: playhead?.playRate ?? 1,
      effectiveBpm: playhead?.bpm ?? null,
      track: this.trackHint(acc),
      loopRoll: acc.loop.loopRollOn === true ? { active: true, beatLength: acc.loop.beatLength ?? null } : null,
      channelFader: acc.upfader,
      crossfader: this.crossfader,
      quality: { playheadSeconds: "exact", playing: "derived", effectiveBpm: "exact" },
    };
    const mapped = this.mapper.update(this.id, hint);
    const state: ProviderDeckState = {
      ...mapped,
      source: "serato",
      track: mapped.track === null ? null : { ...mapped.track, sourceIds: { ...mapped.track.sourceIds, ...this.seratoPathOf(acc) } },
      loop: {
        active: acc.loop.autoLoopOn === true,
        startSeconds: null,
        endSeconds: null,
        beatLength: acc.loop.beatLength ?? null,
      },
      master: null,
      quality: { ...mapped.quality, playheadSeconds: "exact", playing: "derived", effectiveBpm: "exact" },
    };
    this.decks.set(deckId, state);
    this.emit(state);
    return state;
  }

  private trackHint(acc: DeckAccumulator): TrackHint | null {
    const track = acc.track;
    if (!track) return null;
    const filePath = track.filePath === undefined || track.filePath.length === 0 ? null : track.filePath;
    if (filePath === null && track.valid === false) return null;
    const id = filePath ?? `serato:${track.title ?? "unknown"}:${track.artist ?? "unknown"}`;
    return {
      id,
      ...(filePath ? { canonicalPath: filePath } : {}),
      ...(track.title ? { title: track.title } : {}),
      ...(track.artist ? { artist: track.artist } : {}),
    };
  }

  private seratoPathOf(acc: DeckAccumulator): { seratoPath?: string } {
    const filePath = acc.track?.filePath;
    return filePath === undefined || filePath.length === 0 ? {} : { seratoPath: filePath };
  }

  private updateHz(): number {
    const rates = Array.from({ length: NUM_REMOTE_DECKS }, (_, i) => this.updateHzFor(i + 1)).filter((r) => r > 0);
    if (rates.length === 0) return 0;
    return rates.reduce((a, b) => a + b, 0) / rates.length;
  }

  private updateHzFor(deckId: number): number {
    const samples = this.accumulators.get(deckId)?.playheadSamplesMs ?? [];
    if (samples.length < 2) return 0;
    const spanMs = (samples.at(-1) ?? 0) - (samples[0] ?? 0);
    return spanMs <= 0 ? 0 : ((samples.length - 1) * 1000) / spanMs;
  }
}

/**
 * `live.provider` selection helper: DS-01 lists the providers the manager may
 * run, and `serato-remote` (or the plain source name `serato`) selects this
 * one. Returns null for any other selection so the caller keeps its own list.
 */
export function seratoRemoteProviderFor(
  selection: string,
  opts: SeratoRemoteProviderOptions = {},
): SeratoRemoteProvider | null {
  return selection === SERATO_REMOTE_PROVIDER_ID || selection === "serato" ? new SeratoRemoteProvider(opts) : null;
}

function intArg(args: readonly OscMessage["args"][number][], index: number): number | null {
  const value = args[index];
  if (!value) return null;
  if (value.type === "i") return value.value;
  if (value.type === "f") return Math.round(value.value);
  return null;
}

function floatArg(args: readonly OscMessage["args"][number][], index: number): number | null {
  const value = args[index];
  if (!value) return null;
  return value.type === "f" || value.type === "i" ? value.value : null;
}

function stringArg(args: readonly OscMessage["args"][number][], index: number): string | null {
  const value = args[index];
  return value !== undefined && value.type === "s" ? value.value : null;
}

/** The protocol sends booleans as floats (1.0 / 0.0). */
function boolArg(args: readonly OscMessage["args"][number][], index: number): boolean | undefined {
  const value = floatArg(args, index);
  return value === null ? undefined : value >= 0.5;
}
