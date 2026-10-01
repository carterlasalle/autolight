import { createHash } from "node:crypto";

// Session recorder and exact replay (T-DATA-06, F-DATA-06, spec 103).
// Records, when enabled (diagnostics.recorder.enabled): DJ events and deck
// states (raw and normalized), provider status, show decisions, renderer
// frame hashes per tick, device health, errors, config changes. No audio.
//
// Storage is a bounded ring: a circular buffer with a byte budget from
// diagnostics.recorder.maxMb. The oldest entry is overwritten in place, never
// removed with shift() on a large buffer. Export is .ndjson.
//
// Replay feeds the recorded tick inputs back through a render function with
// the same config snapshot and compares frame hashes. Equal hashes prove
// determinism (P-103); a deliberately nondeterministic render fails.

export type SessionKind =
  | "dj-event"
  | "deck-state"
  | "provider-status"
  | "show-decision"
  | "tick-input"
  | "frame-hash"
  | "device-health"
  | "error"
  | "config-change";

export interface SessionRecord {
  seq: number;
  tMs: number;
  kind: SessionKind;
  payload: Record<string, unknown>;
}

export interface SessionRecorderOptions {
  enabled: boolean;
  maxMb: number;
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

// Deterministic frame hash: the same tick inputs plus the same config
// snapshot always produce the same hash. Production passes the real renderer
// frame here; the simulator replay passes its render of the same inputs.
export function frameHashFor(tick: number, inputs: unknown, configSnapshot: Record<string, unknown>): string {
  return stableHash([tick, inputs, configSnapshot]);
}

export class SessionRecorder {
  private readonly slots: (SessionRecord | undefined)[];
  private head = 0;
  private len = 0;
  private seq = 0;
  private bytes = 0;
  private dropped = 0;
  readonly enabled: boolean;
  readonly maxBytes: number;

  constructor(options: SessionRecorderOptions) {
    this.enabled = options.enabled;
    this.maxBytes = Math.max(1, Math.floor(options.maxMb * 1024 * 1024));
    this.slots = new Array<SessionRecord | undefined>(4096);
  }

  get count(): number {
    return this.len;
  }

  get droppedCount(): number {
    return this.dropped;
  }

  record(kind: SessionKind, payload: Record<string, unknown>, tMs: number = Date.now()): void {
    if (!this.enabled) return;
    const entry: SessionRecord = { seq: this.seq++, tMs, kind, payload };
    const size = JSON.stringify(entry).length;
    while (this.len > 0 && this.bytes + size > this.maxBytes) {
      const oldest = this.slots[this.head];
      this.slots[this.head] = undefined;
      this.head = (this.head + 1) % this.slots.length;
      this.len -= 1;
      this.bytes -= oldest === undefined ? 0 : JSON.stringify(oldest).length;
      this.dropped += 1;
    }
    if (size > this.maxBytes) {
      this.dropped += 1;
      return;
    }
    if (this.len === this.slots.length) {
      const oldest = this.slots[this.head];
      this.slots[this.head] = undefined;
      this.head = (this.head + 1) % this.slots.length;
      this.len -= 1;
      this.bytes -= oldest === undefined ? 0 : JSON.stringify(oldest).length;
      this.dropped += 1;
    }
    this.slots[(this.head + this.len) % this.slots.length] = entry;
    this.len += 1;
    this.bytes += size;
  }

  entries(): SessionRecord[] {
    const out: SessionRecord[] = [];
    for (let i = 0; i < this.len; i++) {
      const entry = this.slots[(this.head + i) % this.slots.length];
      if (entry !== undefined) out.push(entry);
    }
    return out;
  }

  exportNdjson(): string {
    return this.entries()
      .map((e) => JSON.stringify(e))
      .join("\n");
  }
}
export interface SessionReplayResult {
  ticks: number;
  matched: number;
  mismatched: number;
  mismatchedTicks: number[];
}

export function parseSessionNdjson(ndjson: string): SessionRecord[] {
  if (ndjson.trim() === "") return [];
  return ndjson.split("\n").map((line, i) => {
    let row: unknown;
    try {
      row = JSON.parse(line);
    } catch {
      throw new Error(`session line ${i + 1}: invalid JSON`);
    }
    if (typeof row !== "object" || row === null || Array.isArray(row)) {
      throw new Error(`session line ${i + 1}: entry must be an object`);
    }
    if (!("seq" in row && "tMs" in row && "kind" in row && "payload" in row)) {
      throw new Error(`session line ${i + 1}: entry needs seq, tMs, kind, payload`);
    }
    if (
      typeof row.seq !== "number" ||
      typeof row.tMs !== "number" ||
      typeof row.kind !== "string" ||
      typeof row.payload !== "object" ||
      row.payload === null ||
      Array.isArray(row.payload)
    ) {
      throw new Error(`session line ${i + 1}: bad entry shape`);
    }
    return { seq: row.seq, tMs: row.tMs, kind: row.kind as SessionKind, payload: row.payload as Record<string, unknown> };
  });
}
// Replay: for every recorded frame hash, find the tick input with the same
// tick, re-render with the same config snapshot, and compare. 100 percent
// equality means the session replays exactly.
export function replaySession(
  records: readonly SessionRecord[],
  configSnapshot: Record<string, unknown>,
  render: (tick: number, inputs: unknown, configSnapshot: Record<string, unknown>) => string,
): SessionReplayResult {
  const inputs = new Map<number, unknown>();
  for (const r of records) {
    if (r.kind === "tick-input" && "tick" in r.payload && typeof r.payload.tick === "number") {
      inputs.set(r.payload.tick, "inputs" in r.payload ? r.payload.inputs : undefined);
    }
  }
  let matched = 0;
  const mismatchedTicks: number[] = [];
  let ticks = 0;
  for (const r of records) {
    if (r.kind !== "frame-hash" || !("tick" in r.payload) || !("hash" in r.payload)) continue;
    if (typeof r.payload.tick !== "number" || typeof r.payload.hash !== "string") continue;
    const tick = r.payload.tick;
    ticks += 1;
    const again = render(tick, inputs.get(tick), configSnapshot);
    if (again === r.payload.hash) matched += 1;
    else mismatchedTicks.push(tick);
  }
  return { ticks, matched, mismatched: mismatchedTicks.length, mismatchedTicks };
}
