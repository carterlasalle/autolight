// Serato capture tool (T-SER-05): a loopback TCP recorder for the Remote
// session.
//
// The wp09 task allows either serato-connect's transport hooks or a loopback
// TCP capture. The published dependency exposes the socket only inside its
// server, so this is the loopback route: a proxy listens on the port Serato
// connects to, forwards every byte to the real provider's server unchanged,
// and keeps the peer-to-us bytes as wire frames. Recorded frames are exactly
// what arrived (split on the 16-byte delimiter the protocol uses), so a
// capture can be committed as a fixture and replayed through the decoder.
//
// The proxy never modifies traffic, never logs payloads and holds no file
// handles; it is a tool for the owner's HW-SER-01 session and for tests.
import { createServer, connect, type Server, type Socket } from "node:net";
import { seratoFrameDelimiter, type SeratoFrame } from "./emulator.js";

export interface SeratoCaptureProxyOptions {
  /** Host of the provider's Remote server. */
  upstreamHost: string;
  /** Port of the provider's Remote server (the provider's advertised port). */
  upstreamPort: number;
  listenHost?: string;
  /** 0 (default) lets the OS pick a port; the peer connects to the chosen one. */
  listenPort?: number;
  now?: () => number;
}

interface Connection {
  downstream: Socket;
  upstream: Socket;
  pending: Buffer;
  /** Outbound carry: the server→us direction rejoins split delimiters too. */
  pendingOut: Buffer;
}

export class SeratoCaptureProxy {
  private readonly options: SeratoCaptureProxyOptions;
  private server: Server | null = null;
  private lastError: string | null = null;
  private readonly connections = new Set<Connection>();
  private readonly capturedInbound: SeratoFrame[] = [];
  private readonly capturedOutbound: SeratoFrame[] = [];

  constructor(options: SeratoCaptureProxyOptions) {
    this.options = options;
  }

  /** Start listening; resolves with the port the peer should connect to. */
  async start(): Promise<{ port: number }> {
    const server = createServer((downstream) => this.handleConnection(downstream));
    this.server = server;
    const { promise, resolve, reject } = Promise.withResolvers<{ port: number }>();
    server.once("error", reject);
    server.listen(this.options.listenPort ?? 0, this.options.listenHost ?? "127.0.0.1", () => {
      // The startup rejection must not stay armed: a later socket error would
      // settle an already-settled promise and disappear silently (batch-16).
      server.off("error", reject);
      server.on("error", (err: Error) => {
        this.lastError = err.message;
      });
      const address = server.address();

      if (address === null || typeof address === "string") {
        // Release the bound socket before failing loudly (batch-16).
        server.close();
        reject(new Error("capture proxy bound to an unexpected address"));

        return;
      }

      resolve({ port: address.port });
    });

    return promise;
  }

  /** Last server-level socket error, for diagnostics (null before any). */
  errorText(): string | null {
    return this.lastError;
  }

  /** Frames the peer sent (the direction a fixture replays). */
  inboundFrames(): SeratoFrame[] {
    return this.capturedInbound.map((frame) => ({ atMs: frame.atMs, bytes: Buffer.from(frame.bytes) }));
  }

  /** Frames the server sent back, kept for diagnostics of the captured session. */
  outboundFrames(): SeratoFrame[] {
    return this.capturedOutbound.map((frame) => ({ atMs: frame.atMs, bytes: Buffer.from(frame.bytes) }));
  }

  async stop(): Promise<void> {
    // Set iteration tolerates the drop handlers deleting their own entries
    // while we destroy them; no copy needed.
    for (const connection of this.connections) {
      connection.downstream.destroy();
      connection.upstream.destroy();
    }

    this.connections.clear();
    const server = this.server;
    this.server = null;

    if (!server) return;
    const { promise, resolve } = Promise.withResolvers<void>();
    server.close(() => resolve());
    await promise;
  }

  private handleConnection(downstream: Socket): void {
    const upstream = connect({ host: this.options.upstreamHost, port: this.options.upstreamPort });
    // Wire both directions synchronously: a socket paused until its upstream
    // connect callback loses whatever the peer sent in the meantime.
    downstream.pipe(upstream);
    upstream.pipe(downstream);
    const connection: Connection = { downstream, upstream, pending: Buffer.alloc(0), pendingOut: Buffer.alloc(0) };
    this.connections.add(connection);
    const now = this.options.now ?? (() => Date.now());
    downstream.on("data", (chunk: Buffer) => {
      this.recordFrames(connection, chunk, now());
    });
    upstream.on("data", (chunk: Buffer) => {
      connection.pendingOut = this.splitInto(this.capturedOutbound, chunk, connection.pendingOut, now());
    });

    const drop = (): void => {
      this.connections.delete(connection);
      downstream.destroy();
      upstream.destroy();
    };

    downstream.on("error", drop);
    upstream.on("error", drop);
    downstream.on("close", drop);
    upstream.on("close", drop);
  }

  private recordFrames(connection: Connection, chunk: Buffer, atMs: number): void {
    connection.pending = this.splitInto(this.capturedInbound, chunk, connection.pending, atMs);
  }

  /** Split `chunk` into complete frames; returns the trailing partial frame. */
  private splitInto(sink: SeratoFrame[], chunk: Buffer, carry: Buffer | null, atMs: number): Buffer {
    const delimiter = seratoFrameDelimiter();
    const stream = carry === null || carry.length === 0 ? chunk : Buffer.concat([carry, chunk]);
    let offset = 0;

    for (;;) {
      const end = stream.indexOf(delimiter, offset);

      if (end === -1) break;
      sink.push({ atMs, bytes: Buffer.from(stream.subarray(offset, end + delimiter.length)) });
      offset = end + delimiter.length;
    }

    return Buffer.from(stream.subarray(offset));
  }
}
