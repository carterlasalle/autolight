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
  return createHash("sha256").update(canonicalJson(value)).digest("hex").slice(0, 16);
}

/** Byte budget is real UTF-8 bytes: `JSON.stringify(x).length` counts UTF-16
 * code units, undercounting non-ASCII payloads and splitting surrogate pairs. */
function recordBytes(entry: SessionRecord): number {
  return Buffer.byteLength(JSON.stringify(entry), "utf8");
}

// Canonical JSON: recursively sorted keys, so key insertion order cannot make
// two semantically identical inputs hash differently.
function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);

  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};

    for (const key of Object.keys(source).sort()) out[key] = sortKeys(source[key]);

    return out;
  }

  return value;
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
    const size = recordBytes(entry);

    // An undroppable record must not evict every stored entry before it is
    // itself dropped.
    if (size > this.maxBytes) {
      this.dropped += 1;

      return;
    }

    while (this.len > 0 && this.bytes + size > this.maxBytes) {
      const oldest = this.slots[this.head];
      this.slots[this.head] = undefined;
      this.head = (this.head + 1) % this.slots.length;
      this.len -= 1;
      this.bytes -= oldest === undefined ? 0 : recordBytes(oldest);
      this.dropped += 1;
    }

    if (this.len === this.slots.length) {
      const oldest = this.slots[this.head];
      this.slots[this.head] = undefined;
      this.head = (this.head + 1) % this.slots.length;
      this.len -= 1;
      this.bytes -= oldest === undefined ? 0 : recordBytes(oldest);
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

const SESSION_KINDS: readonly SessionKind[] = [
  "dj-event",
  "deck-state",
  "provider-status",
  "show-decision",
  "tick-input",
  "frame-hash",
  "device-health",
  "error",
  "config-change",
];

export function parseSessionNdjson(ndjson: string): SessionRecord[] {
  if (ndjson.trim() === "") return [];

  const out: SessionRecord[] = [];
  const lines = ndjson.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";

    // A trailing newline or blank line is not a record: parsing it as JSON
    // would throw on a perfectly valid file.
    if (line.trim() === "") continue;

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

    if (!SESSION_KINDS.includes(row.kind as SessionKind)) {
      throw new Error(`session line ${i + 1}: unknown kind ${JSON.stringify(row.kind)}`);
    }

    out.push({ seq: row.seq, tMs: row.tMs, kind: row.kind as SessionKind, payload: row.payload as Record<string, unknown> });
  }

  return out;
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

    if (!inputs.has(tick)) {
      // No tick-input recorded for this frame: report the missing input rather
      // than rendering unknowns and blaming the renderer.
      mismatchedTicks.push(tick);
      continue;
    }

    const again = render(tick, inputs.get(tick), configSnapshot);

    if (again === r.payload.hash) matched += 1;
    else mismatchedTicks.push(tick);
  }

  return { ticks, matched, mismatched: mismatchedTicks.length, mismatchedTicks };
}
