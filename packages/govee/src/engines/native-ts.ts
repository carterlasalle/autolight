// T-GOV-02: the native TypeScript razer engine (LanStreamEngine on our own
// persistent sockets) with the toolkit's pacing semantics: fixed interval
// emitter, unchanged frames not re-sent, missed ticks skipped and never burst,
// a superseded counter, and a disarm on close. Provenance: govee-toolkit MIT
// (Damien Thery, v0.5.0) `packages/rust/src/stream/{mod.rs,sender.rs,rate.rs}`
// pacing, and docs/protocol/lan.md 1 (consecutive commands), Latency notes,
// 2.1-2.3, 2.7.
//
// Sockets: one persistent UDP socket per device, created on first send and
// reused for every command and frame (T-GOV-04: no socket per send). The
// production wiring injects the govee-manager's bound send methods through
// `transport` (sendToDevice(mac, text), sendRazer(mac, raw)); with no
// injection this engine opens its own sockets, which is what the simulator
// parity test drives.

import { createSocket, type Socket } from "node:dgram";
import {
  WALL_SCHEDULER, PORTS, envelope, colorCommand, turnCommand,
  type EngineHealth, type EngineMetrics, type EngineReport, type EngineStatus,
  type LanStreamEngine, type Scheduler, type SegmentStreamLike, type StreamOptions,
  type StreamTransport, PacingStream,
} from "../razer.js";

// Read-back needs the reply socket, which the manager owns (T-GOV-04), and
// T-GOV-07 owns the retry policy. A transport that cannot ask returns null
// from status(), never a fabricated state.
export interface StatusCapable {
  status(deviceId: string, timeoutMs: number): Promise<EngineStatus | null>;
}

export interface DiscoverCapable {
  discover(): Promise<string[]>;
}

export function hasStatus(transport: StreamTransport): transport is StreamTransport & StatusCapable {
  return "status" in transport && typeof (transport as { status?: unknown }).status === "function";
}

export function hasDiscover(transport: StreamTransport): transport is StreamTransport & DiscoverCapable {
  return "discover" in transport && typeof (transport as { discover?: unknown }).discover === "function";
}

// Default transport: one UDP socket per device id, reused forever. `resolve`
// maps a device id (MAC, T-GOV-06) to its address; the registry owns that map.
export class SocketTransport implements StreamTransport {
  private readonly sockets = new Map<string, Socket>();
  private readonly errors = new Map<string, Error>();

  constructor(
    private readonly resolve: (deviceId: string) => string,
    private readonly port: number = PORTS.CONTROL,
  ) {}

  private socketFor(deviceId: string): Socket {
    const existing = this.sockets.get(deviceId);
    if (existing) return existing;
    const sock = createSocket("udp4");
    // A send error must not kill the process; it is recorded per device and
    // surfaced through health() instead.
    sock.on("error", (err: Error) => { this.errors.set(deviceId, err); });
    this.sockets.set(deviceId, sock);
    return sock;
  }

  private send(deviceId: string, text: string): void {
    const sock = this.socketFor(deviceId);
    const ip = this.resolve(deviceId);
    sock.send(text, this.port, ip, (err: Error | null) => {
      if (err) this.errors.set(deviceId, err);
      else this.errors.delete(deviceId);
    });
  }

  sendRaw(deviceId: string, raw: Uint8Array): void {
    this.send(deviceId, envelope(raw));
  }

  sendJson(deviceId: string, text: string): void {
    this.send(deviceId, text);
  }

  // Fixed socket count after any number of frames (T-GOV-04).
  get openSockets(): number {
    return this.sockets.size;
  }

  errorFor(deviceId: string): Error | null {
    return this.errors.get(deviceId) ?? null;
  }

  close(): void {
    for (const sock of this.sockets.values()) {
      try {
        sock.close();
      } catch {
        // Already released by the socket layer; nothing left to close.
      }
    }
    this.sockets.clear();
  }
}

export interface NativeEngineOptions {
  // Injected transport (govee-manager bound methods). Without it the engine
  // owns persistent sockets of its own.
  transport?: StreamTransport;
  // Address per device for the default socket transport.
  resolve?: (deviceId: string) => string;
  // Ids discover() reports when the transport carries no ladder (T-GOV-05).
  devices?: string[];
  controlPort?: number;
  clock?: Scheduler;
  armSettleMs?: number;
  fallbackRateHz?: number;
  replyTimeoutMs?: number;
  segmentHoldMs?: number;
  identifyFlashMs?: number;
}

// Measured fallback when the frame-rate table has no row for a zone count:
// unmeasured units run at 10 Hz (lan.md 2.3), never at the renderer's 60.
const FALLBACK_HZ = 10;
const DEFAULT_ARM_SETTLE_MS = 50;
const IDENTIFY_FLASH_MS = 600;
const SEGMENT_HOLD_MS = 400;

export class NativeStreamEngine implements LanStreamEngine {
  private readonly transport: StreamTransport;
  private readonly owned: SocketTransport | null;
  private readonly clock: Scheduler;
  private readonly armSettleMs: number;
  private readonly fallbackRateHz: number;
  private readonly replyTimeoutMs: number;
  private readonly segmentHoldMs: number;
  private readonly identifyFlashMs: number;
  private readonly known: string[];
  private readonly streams = new Map<string, PacingStream>();
  private readonly snapshots = new Map<string, EngineMetrics>();

  constructor(opts: NativeEngineOptions = {}) {
    this.clock = opts.clock ?? WALL_SCHEDULER;
    this.armSettleMs = opts.armSettleMs ?? DEFAULT_ARM_SETTLE_MS;
    this.fallbackRateHz = opts.fallbackRateHz ?? FALLBACK_HZ;
    this.replyTimeoutMs = opts.replyTimeoutMs ?? 1000;
    this.segmentHoldMs = opts.segmentHoldMs ?? SEGMENT_HOLD_MS;
    this.identifyFlashMs = opts.identifyFlashMs ?? IDENTIFY_FLASH_MS;
    this.known = opts.devices ? [...opts.devices] : [];
    const resolve = opts.resolve ?? ((deviceId: string) => deviceId);
    this.owned = opts.transport === undefined
      ? new SocketTransport(resolve, opts.controlPort ?? PORTS.CONTROL)
      : null;
    this.transport = opts.transport ?? this.owned!;
  }

  report(): EngineReport {
    return { kind: "native-ts", available: true };
  }

  async discover(): Promise<string[]> {
    if (hasDiscover(this.transport)) return this.transport.discover();
    // The discovery ladder is T-GOV-05; until it is injected this engine
    // reports the devices it was told about, never an invented scan result.
    return [...this.known];
  }

  async status(deviceId: string): Promise<EngineStatus | null> {
    if (hasStatus(this.transport)) return this.transport.status(deviceId, this.replyTimeoutMs);
    // Silence while armed is not a failure (lan.md: a unit may not answer
    // status or devStatus while armed). With no reply socket there is no
    // answer to report, so the caller shows "unknown", not "off".
    return null;
  }

  async openStream(deviceId: string, opts: StreamOptions): Promise<SegmentStreamLike> {
    const existing = this.streams.get(deviceId);
    if (existing) this.snapshot(deviceId, existing);
    // PacingStream arms (B1) itself, then waits the settle before the first
    // paint, exactly as the toolkit binding's openStream does (parity).
    const stream = new PacingStream(deviceId, opts, this.transport, this.clock);
    this.streams.set(deviceId, stream);
    return stream;
  }

  async identify(deviceId: string): Promise<void> {
    const stream = this.streams.get(deviceId);
    if (stream) {
      // Through the stream if armed: white in the channel, then the show
      // frame back (T-GOV-12). With no frame yet, black keeps it quiet (§47).
      const restore = stream.currentFrame;
      const white = new Uint8Array(stream.zones * 3).fill(255);
      stream.setAll(white);
      this.clock.setTimeout(() => {
        stream.setAll(restore ?? new Uint8Array(stream.zones * 3));
      }, this.identifyFlashMs);
      return;
    }
    // Not armed: the official commands, RGB white with kelvin 0 (§48).
    this.transport.sendJson(deviceId, turnCommand(true));
    this.transport.sendJson(deviceId, colorCommand(255, 255, 255));
  }

  async segment(deviceId: string, frame: Uint8Array): Promise<void> {
    // One B0-class pass: arm, wait the settle, paint, hold, disarm. Reuses the
    // stream loop so arm, pacing and disarm semantics stay identical (T-GOV-12).
    const opts: StreamOptions = {
      resolution: frame.length / 3,
      rateHz: 4,
      gradient: 0,
      armSettleMs: this.armSettleMs,
    };
    const oneShot = new PacingStream(deviceId, opts, this.transport, this.clock);
    oneShot.setAll(frame);
    this.clock.setTimeout(() => { oneShot.close(); }, this.armSettleMs + this.segmentHoldMs);
  }

  async health(deviceId: string): Promise<EngineHealth | null> {
    // Send-side health only; read-back health is T-GOV-06/07.
    const err = this.owned?.errorFor(deviceId) ?? null;
    if (err === null && !this.streams.has(deviceId) && !this.known.includes(deviceId)) return null;
    return { state: err === null ? "ok" : "degraded", failures: err === null ? 0 : 1, available: true };
  }

  metrics(deviceId?: string): EngineMetrics[] {
    const ids = deviceId !== undefined
      ? [deviceId]
      : [...new Set([...this.streams.keys(), ...this.snapshots.keys()])];
    return ids.map((id) => {
      const stream = this.streams.get(id);
      if (stream !== undefined) return this.fromStream(stream);
      return this.snapshots.get(id) ?? {
        engine: "native-ts", framesRequested: 0, framesSent: 0,
        framesSuperseded: 0, missedTicks: 0, effectiveHz: 0,
      };
    });
  }

  private fromStream(stream: PacingStream): EngineMetrics {
    return {
      engine: "native-ts",
      framesRequested: stream.framesRequested,
      framesSent: stream.framesSent,
      framesSuperseded: stream.framesSuperseded,
      missedTicks: stream.missedTicks,
      effectiveHz: stream.rateHz,
    };
  }

  private snapshot(deviceId: string, stream: PacingStream): void {
    this.snapshots.set(deviceId, this.fromStream(stream));
  }

  get openSockets(): number {
    return this.owned?.openSockets ?? 0;
  }

  get fallbackHz(): number {
    return this.fallbackRateHz;
  }

  async close(): Promise<void> {
    for (const [id, stream] of this.streams) {
      this.snapshot(id, stream);
      stream.close();
    }
    this.streams.clear();
    this.owned?.close();
  }
}
