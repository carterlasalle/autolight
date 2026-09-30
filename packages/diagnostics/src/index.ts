export interface LogRow { ts: string; monoNs: bigint; module: string; severity: "debug"|"info"|"warn"|"error"; deck?: number; event?: string }
// performance.now fallback: show worker has no process.hrtime (§86).
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
  private events: SessionEvent[] = [];
  constructor(private readonly maxEvents = 100_000) {}
  record(kind: string, payload: Record<string, unknown>): void {
    if (this.events.length >= this.maxEvents) this.events.shift();
    this.events.push({ tNs: nowNs(), kind, payload });
  }
  toNdjson(): string {
    return this.events.map((e) => JSON.stringify({ ...e, tNs: e.tNs.toString() })).join("\n");
  }
  count(): number {
    return this.events.length;
  }
}

// Deterministic session replay (§103, §128): parse recorded .ndjson back to
// events for simulator injection. Malformed lines fail loudly with line number.
export function parseNdjson(ndjson: string): { kind: string; payload: Record<string, unknown>; tNs: string }[] {
  if (!ndjson.trim()) return [];
  return ndjson.split("\n").map((line, i) => {
    try {
      const row = JSON.parse(line) as { kind: string; payload: Record<string, unknown>; tNs: string };
      if (typeof row.kind !== "string" || typeof row.payload !== "object") throw new Error("bad shape");
      return row;
    } catch (e) {
      throw new Error(`session line ${i + 1}: ${(e as Error).message}`);
    }
  });
}
