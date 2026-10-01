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

export function classifyDatagram(text: string): RecordedDatagram["kind"] {
  try {
    const cmd = (JSON.parse(text) as { msg?: { cmd?: unknown } }).msg?.cmd;
    if (cmd === "scan" || cmd === "turn" || cmd === "brightness" || cmd === "colorwc" ||
      cmd === "devStatus" || cmd === "status" || cmd === "razer") return cmd;
  } catch {
    // Falls through to "other" below.
  }
  return "other";
}

export type DatagramSender = (text: string) => void;

export class RecordingTransport {
  readonly records: RecordedDatagram[] = [];
  constructor(private readonly sender: DatagramSender) {}

  send(text: string): void {
    this.records.push({ atMs: Date.now(), text, kind: classifyDatagram(text) });
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
  private held: string | null = null;
  constructor(private readonly sender: DatagramSender, private readonly faults: TransportFaults = {}) {}

  send(text: string): void {
    this.n += 1;
    if (this.faults.dropEvery && this.faults.dropEvery > 0 && this.n % this.faults.dropEvery === 0) return;
    const deliver = (t: string): void => {
      if (this.faults.latencyMs && this.faults.latencyMs > 0) {
        const timer = setTimeout(() => this.sender(t), this.faults.latencyMs);
        timer.unref?.();
      } else {
        this.sender(t);
      }
    };
    if (this.faults.reorderHold) {
      if (this.held !== null) {
        const first = this.held;
        this.held = text;
        deliver(first);
      } else {
        this.held = text;
      }
      return;
    }
    deliver(text);
    if (this.faults.duplicateEvery && this.faults.duplicateEvery > 0 && this.n % this.faults.duplicateEvery === 0) {
      deliver(text);
    }
  }

  flush(): void {
    if (this.held !== null) {
      const text = this.held;
      this.held = null;
      this.sender(text);
    }
  }

  get sent(): number {
    return this.n;
  }
}
