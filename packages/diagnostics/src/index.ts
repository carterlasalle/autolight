export interface LogRow { ts: string; monoNs: bigint; module: string; severity: "debug"|"info"|"warn"|"error"; deck?: number; event?: string }

// performance.now fallback: show worker has no process.hrtime (§86).
// Limitation: performance.now uses a per-context time origin and browsers may
// coarsen/clamp it, so monoNs values from different threads/workers share no
// common origin and float64 ms * 1e6 is not true nanosecond resolution. Use
// monoNs only for within-context deltas, never for cross-context clock/beat
// comparisons without a shared origin.
const nowNs = (): bigint => BigInt(Math.round(performance.now() * 1e6));

export function log(module: string, severity: LogRow["severity"], event: string): LogRow {
  return { ts: new Date().toISOString(), monoNs: nowNs(), module, severity, event };
}

// Local metrics (§131): DJ rates, clock error, render/device FPS, superseded frames.
export interface Metrics {
  djUpdateRateHz: number;
  djStateAgeMs: number;
  beatErrorBeats: number;
  renderMs: number;
  rendererFps: number;
  deviceFps: Record<string, number>;
  supersededFrames: number;
  deviceLatencyMs: Record<string, number>;
}

export function emptyMetrics(): Metrics {
  return {
    djUpdateRateHz: 0, djStateAgeMs: 0, beatErrorBeats: 0, renderMs: 0,
    rendererFps: 0, deviceFps: {}, supersededFrames: 0, deviceLatencyMs: {},
  };
}

// Session recorder (§103): control metadata only, no audio. Replayable into simulator.
export interface SessionEvent { tNs: bigint; kind: string; payload: Record<string, unknown> }

export class SessionRecorder {
  private readonly maxEvents: number;
  private events: SessionEvent[] = [];
  private head = 0;
  private dropped = 0;
  constructor(maxEvents = 100_000) {
    this.maxEvents = Math.max(1, Math.floor(maxEvents));
  }
  record(kind: string, payload: Record<string, unknown>): void {
    const event: SessionEvent = { tNs: nowNs(), kind, payload };

    if (this.events.length < this.maxEvents) {
      this.events.push(event);

      return;
    }

    this.events[this.head] = event;
    this.head = (this.head + 1) % this.maxEvents;
    this.dropped += 1;
  }
  /** Oldest-first snapshot of the ring buffer. */
  private ordered(): SessionEvent[] {
    if (this.dropped === 0) return this.events;

    return [...this.events.slice(this.head), ...this.events.slice(0, this.head)];
  }
  /** Events discarded by saturation; 0 until the buffer first fills. */
  droppedCount(): number {
    return this.dropped;
  }
  toNdjson(): string {
    return this.ordered().map((e) => safeEventLine(e)).join("\n");
  }
  /** Newest slice for live diagnostics surfaces (receipts). */
  tail(n: number): SessionEvent[] {
    const all = this.ordered();

    return all.slice(Math.max(0, all.length - Math.max(0, Math.floor(n))));
  }
  count(): number {
    return this.events.length;
  }
}

// Deterministic session replay (§103, §128): parse recorded .ndjson back to
// events for simulator injection. Malformed lines fail loudly with line number.
export function parseNdjson(ndjson: string): { kind: string; payload: Record<string, unknown>; tNs: string }[] {
  if (!ndjson.trim()) return [];
  const out: { kind: string; payload: Record<string, unknown>; tNs: string }[] = [];

  ndjson.split("\n").forEach((line, i) => {
    if (line.trim() === "") return;

    try {
      const row = JSON.parse(line) as { kind: string; payload: Record<string, unknown>; tNs: string };

      if (
        typeof row.kind !== "string" ||
        typeof row.tNs !== "string" ||
        typeof row.payload !== "object" ||
        row.payload === null ||
        Array.isArray(row.payload)
      ) throw new Error("bad shape");
      out.push(row);
    } catch (e) {
      throw new Error(`session line ${i + 1}: ${(e as Error).message}`, { cause: e });
    }
  });

  return out;
}

function safeEventLine(e: SessionEvent): string {
  try {
    return JSON.stringify({ ...e, tNs: e.tNs.toString() }, (_key, value: unknown) =>
      typeof value === "bigint" ? value.toString() : value,
    );
  } catch (error) {
    return JSON.stringify({ tNs: e.tNs.toString(), kind: e.kind, payload: {}, error: `unserializable payload: ${error instanceof Error ? error.message : String(error)}` });
  }
}
