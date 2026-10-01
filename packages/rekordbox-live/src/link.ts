// Ableton Link participation (`link`, T-LIVE-12, F-LIVE-11, DS-36).
//
// License boundary: the Link SDK is GPL-2.0-or-later unless Ableton grants
// its proprietary license, so it cannot be linked into AutoLight without an
// owner decision. Behind `live.link.mode` (DS-36):
// - `sidecar`: a separately installed Link bridge process (such as Deep
//   Symmetry's Carabiner, which exposes Link over a local TCP socket).
//   User-installed, never bundled without a decision, treated like
//   rkbx_link: this module only speaks the bridge socket protocol.
// - `sdk`: link the SDK in a native addon only if the owner obtains
//   Ableton's license. This module exposes the seam (LinkTransport) the
//   addon would implement; no SDK code is here.
// - `auto`: sidecar when present, SDK build when licensed, otherwise
//   `UNAVAILABLE_ON_THIS_DEVICE` with the reason.
//
// Bridge wire format (our sidecar-client half, documented here and tested
// against a scripted sidecar speaking it over a real TCP socket): newline
// separated JSON, one object per line, fields per direction:
// - sidecar to us: { tempo: number (bpm), beat: number (session beat),
//   phase: number (0..1 within quantum), quantum: number (beats per cycle),
//   playing: boolean, atMs: number (sidecar clock) }.
// - us to sidecar: { setTempo?: number, setPlaying?: boolean } when
//   `live.link.publish` is true (publish our show clock so other tools can
//   follow AutoLight). Never sent unless publish is enabled.
//
// Use: tempo and phase input to the composite provider (CompositeLinkTempo
// seam) and the adaptive clock (DS-23), plus a cross-check for fusion.
// Malformed lines are rejected and counted, never thrown.
import { createConnection, createServer, type Server, type Socket } from "node:net";
import { z } from "zod";

export const LINK_DEFAULT_QUANTUM = 4;

export type LinkMode = "sidecar" | "sdk" | "auto";

const sidecarTempoSchema = z.object({
  tempo: z.number(),
  beat: z.number(),
  phase: z.number(),
  quantum: z.number().optional(),
  playing: z.boolean().optional(),
  atMs: z.number().optional(),
});

export type LinkTempo = z.infer<typeof sidecarTempoSchema> & { atNs: bigint };

export interface LinkState {
  readonly bpm: number;
  readonly beat: number;
  readonly phase: number;
  readonly quantum: number;
  readonly playing: boolean | null;
}

export interface LinkTransport {
  readonly mode: LinkMode;
  start(): Promise<void>;
  stop(): Promise<void>;
  latest(): LinkState | null;
  publish(opts: { tempo?: number; playing?: boolean }): void;
  onTempo(listener: (tempo: LinkTempo) => void): () => void;
  getStatus(): { state: string; detail: string };
}

export function parseSidecarLine(line: string, atNs: bigint): LinkTempo | null {
  try {
    const parsed = sidecarTempoSchema.parse(JSON.parse(line));
    return { ...parsed, atNs };
  } catch {
    return null;
  }
}

export interface SidecarLinkOptions {
  host?: string;
  port?: number;
  quantum?: number;
  now?: () => bigint;
}

export class SidecarLinkTransport implements LinkTransport {
  readonly mode: LinkMode = "sidecar";
  private readonly host: string;
  private readonly port: number;
  private readonly quantum: number;
  private readonly now: () => bigint;
  private socket: Socket | null = null;
  private tail = "";
  private current: LinkState | null = null;
  private readonly listeners = new Set<(tempo: LinkTempo) => void>();
  private rejected = 0;

  constructor(opts: SidecarLinkOptions = {}) {
    this.host = opts.host ?? "127.0.0.1";
    this.port = opts.port ?? 17000;
    this.quantum = opts.quantum ?? LINK_DEFAULT_QUANTUM;
    this.now = opts.now ?? (() => BigInt(Date.now()) * 1_000_000n);
  }

  rejectedCount(): number {
    return this.rejected;
  }

  async start(): Promise<void> {
    if (this.socket) return;
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const socket = createConnection({ host: this.host, port: this.port });
    this.socket = socket;
    socket.setEncoding("utf8");
    socket.once("connect", () => resolve());
    socket.once("error", (err: Error) => {
      this.socket = null;
      reject(err);
    });
    socket.on("data", (chunk: string) => this.ingest(chunk));
    socket.on("close", () => {
      if (this.socket === socket) this.socket = null;
    });
    await promise;
  }

  async stop(): Promise<void> {
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    const { promise, resolve } = Promise.withResolvers<void>();
    socket.once("close", () => resolve());
    socket.destroy();
    await promise;
  }

  latest(): LinkState | null {
    return this.current;
  }

  publish(opts: { tempo?: number; playing?: boolean }): void {
    const socket = this.socket;
    if (!socket) return;
    const out: Record<string, unknown> = {};
    if (opts.tempo !== undefined) out["setTempo"] = opts.tempo;
    if (opts.playing !== undefined) out["setPlaying"] = opts.playing;
    if (Object.keys(out).length > 0) socket.write(JSON.stringify(out) + "\n");
  }

  onTempo(listener: (tempo: LinkTempo) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getStatus(): { state: string; detail: string } {
    if (this.socket && this.current) {
      return { state: "live", detail: `sidecar ${this.current.bpm.toFixed(1)} bpm phase ${this.current.phase.toFixed(2)}` };
    }
    if (this.socket) return { state: "starting", detail: "sidecar connected, no tempo yet" };
    return { state: "unavailable", detail: `no sidecar on ${this.host}:${this.port}` };
  }

  ingest(chunk: string): void {
    const combined = this.tail + chunk;
    const lines = combined.split("\n");
    this.tail = lines.pop() ?? "";
    for (const line of lines) {
      const text = line.trim();
      if (!text) continue;
      const tempo = parseSidecarLine(text, this.now());
      if (!tempo) {
        this.rejected += 1;
        continue;
      }
      this.current = {
        bpm: tempo.tempo,
        beat: tempo.beat,
        phase: tempo.phase,
        quantum: tempo.quantum ?? this.quantum,
        playing: tempo.playing ?? null,
      };
      for (const listener of this.listeners) listener(tempo);
    }
  }
}

export interface FakeSidecar {
  server: Server;
  port: number;
  received: string[];
  send(line: string): void;
}

// Scripted sidecar for tests: speaks the bridge protocol over a real TCP
// socket, records what the client publishes.
export async function startFakeSidecar(onLine?: (line: string) => void): Promise<FakeSidecar> {
  const received: string[] = [];
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      for (const line of chunk.split("\n")) {
        const text = line.trim();
        if (!text) continue;
        received.push(text);
        onLine?.(text);
      }
    });
    socket.on("close", () => sockets.delete(socket));
  });
  const { promise, resolve } = Promise.withResolvers<void>();
  server.listen(0, "127.0.0.1", () => resolve());
  await promise;
  const address = server.address();
  const port = address && typeof address === "object" ? address.port : 0;
  return {
    server,
    port,
    received,
    send(line: string) {
      for (const socket of sockets) socket.write(line + "\n");
    },
  };
}

export async function stopFakeSidecar(fake: FakeSidecar): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  fake.server.close(() => resolve());
  await promise;
}

export interface LinkDecision {
  readonly mode: Exclude<LinkMode, "auto"> | "unavailable";
  readonly reason: string;
}

// `auto` (DS-36 combined): sidecar when present, SDK build when licensed,
// otherwise UNAVAILABLE_ON_THIS_DEVICE with the reason.
export function resolveLinkMode(opts: {
  mode: LinkMode;
  sidecarPresent: boolean;
  sdkLicensed: boolean;
}): LinkDecision {
  if (opts.mode === "sidecar") {
    return opts.sidecarPresent
      ? { mode: "sidecar", reason: "sidecar bridge present" }
      : { mode: "unavailable", reason: "no Link sidecar on its socket; install the bridge or use another clock" };
  }
  if (opts.mode === "sdk") {
    return opts.sdkLicensed
      ? { mode: "sdk", reason: "SDK build licensed" }
      : { mode: "unavailable", reason: "Link SDK not licensed (Ableton proprietary license required)" };
  }
  if (opts.sidecarPresent) return { mode: "sidecar", reason: "auto: sidecar present" };
  if (opts.sdkLicensed) return { mode: "sdk", reason: "auto: licensed SDK build present" };
  return { mode: "unavailable", reason: "UNAVAILABLE_ON_THIS_DEVICE: no sidecar and no licensed SDK build" };
}

// Phase agreement cross-check for fusion: beats between the Link session
// beat and a provider playhead-derived beat.
export function linkBeatDisagreement(linkBeat: number, providerBeat: number): number {
  return Math.abs(linkBeat - providerBeat);
}
