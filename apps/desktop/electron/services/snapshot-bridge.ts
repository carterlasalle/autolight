// Snapshot bridge (T-ARC-04, spec 108): main-side forwarder from the show
// host to subscribed renderers, latest wins.
//
// The host publishes at runtime.snapshot.uiRateHz; the bridge keeps only the
// newest snapshot and replays it to every subscriber. Renderers subscribe on
// load, so a reloaded window resubscribes and renders within one snapshot
// interval; the show host never notices the reload and the transport never
// gaps. No timing, no I/O, no authoritative state here: forwarding only.

export interface SnapshotRendererPort {
  send(channel: string, payload: unknown): void;
  onDidFinishLoad(listener: () => void): void;
}

export interface SnapshotHostPort {
  onMessage(listener: (message: unknown) => void): void;
}

export interface SnapshotBridgeCounts {
  received: number;
  forwarded: number;
  subscribers: number;
}

function isSnapshotMessage(message: unknown): message is { type: "snapshot"; snapshot: unknown } {
  if (typeof message !== "object" || message === null || !("type" in message)) return false;
  const record = message as { type?: unknown; snapshot?: unknown };
  return record.type === "snapshot" && record.snapshot !== undefined;
}

export class SnapshotBridge {
  private latest: unknown = null;
  private received = 0;
  private forwarded = 0;
  private readonly subscribers = new Set<SnapshotRendererPort>();

  constructor(private readonly hostPort: SnapshotHostPort) {
    hostPort.onMessage((message) => this.onHostMessage(message));
  }

  subscribe(renderer: SnapshotRendererPort): () => void {
    this.subscribers.add(renderer);
    renderer.onDidFinishLoad(() => this.replay(renderer));
    if (this.latest !== null) {
      renderer.send("show/snapshot", this.latest);
      this.forwarded += 1;
    }
    return () => {
      this.subscribers.delete(renderer);
    };
  }

  latestSnapshot(): unknown {
    return this.latest;
  }

  counts(): SnapshotBridgeCounts {
    return { received: this.received, forwarded: this.forwarded, subscribers: this.subscribers.size };
  }

  private onHostMessage(message: unknown): void {
    if (!isSnapshotMessage(message)) return;
    this.latest = message.snapshot;
    this.received += 1;
    for (const renderer of this.subscribers) {
      renderer.send("show/snapshot", message.snapshot);
      this.forwarded += 1;
    }
  }

  private replay(renderer: SnapshotRendererPort): void {
    if (this.latest === null) return;
    renderer.send("show/snapshot", this.latest);
    this.forwarded += 1;
  }
}
