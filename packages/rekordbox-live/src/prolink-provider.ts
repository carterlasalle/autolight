// PRO DJ LINK provider (`prolink`, T-LIVE-05, F-LIVE-04, DS-29).
//
// Sockets: keepalives (50000) give peer presence with expiry
// (live.prolink.peerExpiryMs); beat packets (50001, 0x60 bytes) give BPM and
// beat timing; status packets (50002) give track ID, slot, play state, master
// and sync flags. Socket errors become provider status, never silently
// swallowed (S5).
//
// Modes (DS-29): `passive` listens only; `virtual-cdj` announces the
// configured device number (live.prolink.deviceNumber) with keepalives every
// live.prolink.keepaliveMs, which some equipment requires before sending
// status; `auto` starts passive and promotes to virtual CDJ only while no
// real device uses the configured number.
//
// No absolute playhead exists in these packets, so the playhead is estimated
// from the beat counter and labelled `estimated`.
import { createSocket, type Socket } from "node:dgram";
import {
  buildKeepalivePacket,
  decodeProlinkPacket,
  pitchPercent,
  PROLINK_PORTS,
  type ProlinkBeat,
  type ProlinkDecoded,
  type ProlinkStatusFrame,
} from "./prolink.js";
import {
  DeckGenerationMapper,
  ProviderBase,
  type ClockFn,
  type ProviderCapabilities,
  type ProviderDeckState,
  type QualityLabel,
} from "./providers.js";

export type ProlinkMode = "passive" | "virtual-cdj" | "auto";

export interface ProlinkPeer {
  deviceNumber: number;
  deviceName: string;
  lastSeenNs: bigint;
}

export interface ProlinkProviderOptions {
  now?: ClockFn;
  bind?: string | null;
  mode?: ProlinkMode;
  deviceNumber?: number;
  keepaliveMs?: number;
  peerExpiryMs?: number;
  sendDatagram?: (bytes: Uint8Array) => void;
  deviceName?: string;
}

interface DeviceBuffer {
  beatCounter: number;
  bpm: number | null;
  pitch: number;
  playing: boolean | null;
  master: boolean | null;
  sync: boolean | null;
  loopActive: boolean | null;
  trackId: number | null;
  trackSlot: number | null;
  beatInBar: number | null;
}

function emptyDevice(): DeviceBuffer {
  return {
    beatCounter: 0,
    bpm: null,
    pitch: 0x100000,
    playing: null,
    master: null,
    sync: null,
    loopActive: null,
    trackId: null,
    trackSlot: null,
    beatInBar: null,
  };
}

export class ProlinkProvider extends ProviderBase {
  private readonly peersByNumber = new Map<number, ProlinkPeer>();
  private readonly devices = new Map<number, DeviceBuffer>();
  private readonly mapper = new DeckGenerationMapper();
  private readonly capabilities: ProviderCapabilities = {
    master: true, loop: false, pitch: true, sync: true, hotCue: false, roll: false,
  };
  private readonly options: Required<Omit<ProlinkProviderOptions, "bind" | "now" | "sendDatagram">> & {
    bind: string | null;
    sendDatagram: ((bytes: Uint8Array) => void) | null;
  };
  private socket: Socket | null = null;
  private lastKeepaliveNs: bigint | null = null;

  constructor(opts: ProlinkProviderOptions = {}) {
    super("prolink", "rekordbox", opts.now);
    this.options = {
      bind: opts.bind ?? null,
      mode: opts.mode ?? "passive",
      deviceNumber: opts.deviceNumber ?? 7,
      keepaliveMs: opts.keepaliveMs ?? 1500,
      peerExpiryMs: opts.peerExpiryMs ?? 5000,
      sendDatagram: opts.sendDatagram ?? null,
      deviceName: opts.deviceName ?? "autolight",
    };
  }

  protected async onStart(): Promise<void> {
    this.setStatus({ state: "starting" });
    if (this.options.bind === null) return;
    const [host, port] = splitHostPort(this.options.bind);
    const socket = createSocket({ type: "udp4", reuseAddr: true });
    this.socket = socket;
    socket.on("message", (msg: Buffer) => this.ingestPacket(new Uint8Array(msg)));
    socket.on("error", (err: Error) => {
      this.setStatus({ state: "failed", error: `prolink socket: ${err.message}` });
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
      this.setStatus({ state: "failed", error: `prolink bind ${this.options.bind ?? ""}: ${err instanceof Error ? err.message : String(err)}` });
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
    return [...this.devices.keys()].sort((a, b) => a - b).map((device) => this.stateFor(device));
  }

  get boundPort(): number | null {
    const address = this.socket?.address();
    return address && typeof address === "object" ? address.port : null;
  }

  getPeers(atNs?: bigint): ProlinkPeer[] {
    const at = atNs ?? this.now();
    this.expirePeers(at);
    return [...this.peersByNumber.values()].sort((a, b) => a.deviceNumber - b.deviceNumber);
  }

  // auto: promote only while no real device uses the configured number.
  // Peers expire on read: a collision older than peerExpiryMs no longer blocks.
  effectiveMode(atNs?: bigint): "passive" | "virtual-cdj" {
    if (this.options.mode === "virtual-cdj") return "virtual-cdj";
    if (this.options.mode === "passive") return "passive";
    this.expirePeers(atNs ?? this.now());
    const collision = this.peersByNumber.has(this.options.deviceNumber);
    return collision ? "passive" : "virtual-cdj";
  }

  // Keepalives are only ever sent in virtual-cdj mode.
  shouldSendKeepalive(atNs?: bigint): boolean {
    if (this.effectiveMode() !== "virtual-cdj") return false;
    const at = atNs ?? this.now();
    if (this.lastKeepaliveNs === null) return true;
    return Number(at - this.lastKeepaliveNs) / 1e6 >= this.options.keepaliveMs;
  }

  ingestPacket(data: Uint8Array, atNs?: bigint): ProlinkDecoded {
    const at = atNs ?? this.now();
    const decoded = decodeProlinkPacket(data);
    if (decoded.kind === "malformed") {
      this.markRejected(decoded.reason);
      return decoded;
    }
    if (decoded.kind === "keepalive") {
      this.peersByNumber.set(decoded.deviceNumber, {
        deviceNumber: decoded.deviceNumber,
        deviceName: decoded.header.deviceName,
        lastSeenNs: at,
      });
      this.setStatus({ state: "live", updateHz: 0, ageMs: 0 });
      return decoded;
    }
    const buffer = this.bufferFor(decoded.deviceNumber);
    if (decoded.kind === "beat") this.applyBeat(buffer, decoded);
    else this.applyStatus(buffer, decoded);
    this.setStatus({ state: "live", updateHz: 0, ageMs: 0 });
    this.emit(this.stateFor(decoded.deviceNumber, at));
    return decoded;
  }

  // Time-driven work: peer expiry and the virtual CDJ keepalive.
  tick(atNs?: bigint): void {
    const at = atNs ?? this.now();
    this.expirePeers(at);
    if (!this.shouldSendKeepalive(at)) return;
    const bytes = buildKeepalivePacket(this.options.deviceName, this.options.deviceNumber);
    this.lastKeepaliveNs = at;
    if (this.options.sendDatagram) this.options.sendDatagram(bytes);
    else if (this.socket) this.socket.send(Buffer.from(bytes), PROLINK_PORTS.keepalive, "255.255.255.255");
  }

  private expirePeers(atNs: bigint): void {
    for (const [number, peer] of this.peersByNumber) {
      if (Number(atNs - peer.lastSeenNs) / 1e6 > this.options.peerExpiryMs) this.peersByNumber.delete(number);
    }
  }

  private bufferFor(device: number): DeviceBuffer {
    let buffer = this.devices.get(device);
    if (!buffer) {
      buffer = emptyDevice();
      this.devices.set(device, buffer);
    }
    return buffer;
  }

  private applyBeat(buffer: DeviceBuffer, beat: ProlinkBeat): void {
    buffer.beatCounter += 1;
    buffer.pitch = beat.pitch;
    if (beat.bpm !== null) buffer.bpm = beat.bpm;
    if (beat.beatInBar !== null) buffer.beatInBar = beat.beatInBar;
  }

  private applyStatus(buffer: DeviceBuffer, status: ProlinkStatusFrame): void {
    // T-LIVE-14: a track change ends the old generation. Reset the loop flag
    // and the beat counter so a loop or position from the previous track
    // cannot leak into the new generation.
    if (status.trackId !== null && buffer.trackId !== null && status.trackId !== buffer.trackId) {
      buffer.loopActive = null;
      buffer.beatCounter = 0;
    }
    buffer.playing = status.playing;
    buffer.master = status.master;
    buffer.sync = status.sync;
    buffer.loopActive = status.loopActive;
    buffer.pitch = status.pitch;
    buffer.trackId = status.trackId;
    buffer.trackSlot = status.trackSlot;
    if (status.beatInBar !== null) buffer.beatInBar = status.beatInBar;
  }

  private stateFor(device: number, atNs?: bigint): ProviderDeckState {
    const buffer = this.bufferFor(device);
    const playheadSeconds = this.estimatePlayhead(buffer);
    const track = buffer.trackId === null
      ? null
      : { id: `rb:${buffer.trackId}`, sourceIds: { rekordboxId: String(buffer.trackId) } };
    return this.mapper.update(this.id, {
      deckId: device,
      atNs: atNs ?? this.now(),
      playing: buffer.playing ?? false,
      playheadSeconds,
      playRate: buffer.pitch / 0x100000,
      effectiveBpm: buffer.bpm,
      track,
      beat: buffer.beatCounter > 0 ? buffer.beatCounter : null,
      beatInBar: asBeatInBar(buffer.beatInBar),
      pitchPercent: pitchPercent(buffer.pitch),
      sync: buffer.sync,
      loopRoll: buffer.loopActive === null ? null : { active: buffer.loopActive, beatLength: null },
      master: buffer.master,
      quality: this.qualityFor(buffer),
    });
  }

  private qualityFor(buffer: DeviceBuffer): Partial<Record<keyof ProviderDeckState, QualityLabel>> {
    return {
      playheadSeconds: "estimated",
      playing: "exact",
      pitchPercent: "exact",
      effectiveBpm: buffer.bpm === null ? "estimated" : "exact",
      beat: "derived",
      loopRoll: "estimated",
      master: "exact",
      sync: "exact",
    };
  }

  // Beat-counter estimate only: these packets carry no absolute position.
  private estimatePlayhead(buffer: DeviceBuffer): number {
    if (buffer.bpm === null || buffer.beatCounter === 0) return 0;
    return ((buffer.beatCounter - 1) * 60) / buffer.bpm;
  }
}

function asBeatInBar(value: number | null): 1 | 2 | 3 | 4 | null {
  return value === 1 || value === 2 || value === 3 || value === 4 ? value : null;
}

function splitHostPort(bind: string): [string, number] {
  const at = bind.lastIndexOf(":");
  const host = at === -1 ? "0.0.0.0" : bind.slice(0, at);
  const port = at === -1 ? Number(bind) : Number(bind.slice(at + 1));
  return [host.length > 0 ? host : "0.0.0.0", Number.isFinite(port) ? port : 0];
}
