// Recording and fault-injecting transports (T-GOV-14, spec 104).
// RecordingTransport wraps a datagram sender and records every datagram with
// a timestamp for assertions (zero turn commands while armed, blackout is
// zeros not power-off, brightness rate). FaultInjectingTransport replays the
// simulator fault list in front of any sender so GOV probes exercise traps
// without sockets. No claim is made about hardware. Simulator runs prove
// code, never hardware.
export interface RecordedDatagram {
  atMs: number;
  text: string;
  kind: "scan" | "turn" | "brightness" | "colorwc" | "devStatus" | "status" | "razer" | "other";
}

// Malformed datagrams are counted instead of silently dropped: a test that
// expects a datagram can read this counter to see that the text never
// classified (module-level so it is visible without a transport instance).
export let malformedDatagrams = 0;

export function classifyDatagram(text: string): RecordedDatagram["kind"] {
  try {
    // JSON.parse returns `any`; read the envelope defensively without a cast.
    const cmd: unknown = JSON.parse(text)?.msg?.cmd;

    if (cmd === "scan" || cmd === "turn" || cmd === "brightness" || cmd === "colorwc" ||
      cmd === "devStatus" || cmd === "status" || cmd === "razer") return cmd;
  } catch {
    // Not JSON at all: count it so a malformed datagram is diagnosable, then
    // fall through to "other" so recording never throws mid-run.
    malformedDatagrams += 1;
  }

  return "other";
}

export type DatagramSender = (text: string) => void;

export class RecordingTransport {
  readonly records: RecordedDatagram[] = [];
  // Injectable clock: timing assertions stay deterministic instead of
  // depending on machine scheduling.
  constructor(private readonly sender: DatagramSender, private readonly now: () => number = Date.now) {}

  send(text: string): void {
    this.records.push({ atMs: this.now(), text, kind: classifyDatagram(text) });
    this.sender(text);
  }

  byKind(kind: RecordedDatagram["kind"]): RecordedDatagram[] {
    return this.records.filter((r) => r.kind === kind);
  }

  count(kind: RecordedDatagram["kind"]): number {
    return this.byKind(kind).length;
  }
}

export interface TransportFaults {
  dropEvery?: number;
  duplicateEvery?: number;
  latencyMs?: number;
  reorderHold?: boolean;
}

export class FaultInjectingTransport {
  private n = 0;
  // The held datagram keeps its own sequence number, so duplication is
  // decided by the datagram's own position, not by the send that releases it.
  private held: { text: string; seq: number } | null = null;
  // Latency is fire-and-forget only until drained: every pending delivery is
  // tracked so `drain()` can force it out instead of losing the datagram when
  // a test finishes before `latencyMs` elapses.
  private readonly pending: { timer: NodeJS.Timeout; text: string }[] = [];
  constructor(private readonly sender: DatagramSender, private readonly faults: TransportFaults = {}) {}

  send(text: string): void {
    this.n += 1;
    const seq = this.n;

    if (this.faults.dropEvery && this.faults.dropEvery > 0 && seq % this.faults.dropEvery === 0) return;

    if (this.faults.reorderHold) {
      if (this.held !== null) {
        const first = this.held;
        this.held = { text, seq };
        this.emit(first);
      } else {
        this.held = { text, seq };
      }

      return;
    }

    this.emit({ text, seq });
  }

  // The single delivery path: duplication and latency both live here, so
  // `send()` and `flush()` can never produce different delivered sets.
  private emit(datagram: { text: string; seq: number }): void {
    this.deliver(datagram.text);

    if (this.faults.duplicateEvery && this.faults.duplicateEvery > 0 && datagram.seq % this.faults.duplicateEvery === 0) {
      this.deliver(datagram.text);
    }
  }

  private deliver(text: string): void {
    const latency = this.faults.latencyMs ?? 0;

    if (latency <= 0) {
      this.sender(text);

      return;
    }

    const timer = setTimeout(() => {
      const index = this.pending.findIndex((entry) => entry.timer === timer);

      if (index >= 0) this.pending.splice(index, 1);
      this.sender(text);
    }, latency);

    this.pending.push({ timer, text });
  }

  // Force every latency-delayed datagram out now, in arrival order, so a test
  // that finishes (or a caller wanting a clean boundary) never drops one.
  drain(): void {
    for (const { timer, text } of this.pending.splice(0)) {
      clearTimeout(timer);
      this.sender(text);
    }
  }

  flush(): void {
    if (this.held !== null) {
      const datagram = this.held;
      this.held = null;
      this.emit(datagram);
    }
  }

  get sent(): number {
    return this.n;
  }
}
