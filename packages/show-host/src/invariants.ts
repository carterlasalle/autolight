// T-TRU-12 runtime invariants. Cheap checks safe to run in production:
// checkInvariants never throws; violations are reported, never raised.

export const INVARIANT_CODES = [
  "pending-frames",
  "armed-power",
  "segment-zones",
  "tick-thread",
  "finite-beats",
  "deck-age",
  "brightness-rate",
  "no-cloud-frames",
] as const;
export type InvariantCode = (typeof INVARIANT_CODES)[number];

export interface InvariantCommand {
  deviceId: string;
  kind: string;
  on?: boolean;
  kelvin?: number;
}

export interface InvariantTransport {
  deviceId: string;
  transport: string;
}

export interface InvariantContext {
  pendingPerDevice: Record<string, number>;
  outgoingCommands: InvariantCommand[];
  armedDevices: Record<string, boolean>;
  expectedZones: Record<string, number>;
  frameZones: Record<string, number>;
  hostThreadId: number | string;
  rendererThreadId: number | string;
  beats: number[];
  deckAgeMs: number;
  staleMs: number;
  clockHealth: string;
  brightnessTimestampsMs: number[];
  nowMs: number;
  maxPerMinute: number;
  transports: InvariantTransport[];
}

export interface InvariantViolation {
  code: InvariantCode;
  message: string;
  deviceId?: string;
}

// Structural hook into diagnostics: SessionRecorder satisfies this shape
// (record(kind, payload)) without importing it here.
export interface InvariantTelemetry {
  record: (kind: string, payload: Record<string, unknown>) => void;
}

function violation(code: InvariantCode, message: string, deviceId?: string): InvariantViolation {
  return deviceId === undefined ? { code, message } : { code, message, deviceId };
}

export function checkInvariants(
  ctx: InvariantContext,
  telemetry?: InvariantTelemetry,
): InvariantViolation[] {
  let out: InvariantViolation[];
  try {
    out = runChecks(ctx);
  } catch {
    out = [violation("finite-beats", "invariant check failed internally")];
  }
  if (telemetry !== undefined) {
    try {
      for (const v of out) {
        telemetry.record("invariant", {
          code: v.code,
          message: v.message,
          deviceId: v.deviceId ?? null,
        });
      }
    } catch {
      // Telemetry must never crash the show.
    }
  }
  return out;
}

function runChecks(ctx: InvariantContext): InvariantViolation[] {
  const out: InvariantViolation[] = [];
  checkPending(ctx, out);
  checkArmed(ctx, out);
  checkZones(ctx, out);
  checkThread(ctx, out);
  checkBeats(ctx, out);
  checkDeckAge(ctx, out);
  checkBrightness(ctx, out);
  checkCloud(ctx, out);
  return out;
}

function checkPending(ctx: InvariantContext, out: InvariantViolation[]): void {
  for (const [deviceId, pending] of Object.entries(ctx.pendingPerDevice)) {
    if (pending > 1) {
      out.push(violation("pending-frames", `device holds ${pending} pending frames, at most 1 allowed`, deviceId));
    }
  }
}

function checkArmed(ctx: InvariantContext, out: InvariantViolation[]): void {
  for (const cmd of ctx.outgoingCommands) {
    if (ctx.armedDevices[cmd.deviceId] !== true) continue;
    if (cmd.kind === "turn" && cmd.on === false) {
      out.push(violation("armed-power", "turn off sent to an armed fixture", cmd.deviceId));
    }
    if (cmd.kind === "colorwc" && (cmd.kelvin ?? 0) !== 0) {
      out.push(violation("armed-power", `kelvin colorwc (${cmd.kelvin}K) sent to an armed fixture`, cmd.deviceId));
    }
  }
}

function checkZones(ctx: InvariantContext, out: InvariantViolation[]): void {
  for (const [deviceId, expected] of Object.entries(ctx.expectedZones)) {
    const actual = ctx.frameZones[deviceId];
    if (actual !== expected) {
      out.push(
        violation(
          "segment-zones",
          `segmented fixture expects ${expected} zones, frame carries ${actual ?? 0}`,
          deviceId,
        ),
      );
    }
  }
}

function checkThread(ctx: InvariantContext, out: InvariantViolation[]): void {
  if (ctx.hostThreadId === ctx.rendererThreadId) {
    out.push(violation("tick-thread", "show host tick runs on the renderer thread"));
  }
}

function checkBeats(ctx: InvariantContext, out: InvariantViolation[]): void {
  for (const beat of ctx.beats) {
    if (!Number.isFinite(beat)) {
      out.push(violation("finite-beats", "non-finite beat value in frame context"));
      return;
    }
  }
}

function checkDeckAge(ctx: InvariantContext, out: InvariantViolation[]): void {
  if (ctx.clockHealth === "live" && ctx.deckAgeMs > ctx.staleMs) {
    out.push(
      violation("deck-age", `DeckState age ${ctx.deckAgeMs}ms exceeds staleMs ${ctx.staleMs}ms while health is live`),
    );
  }
}

function checkBrightness(ctx: InvariantContext, out: InvariantViolation[]): void {
  const windowStart = ctx.nowMs - 60_000;
  let count = 0;
  for (const t of ctx.brightnessTimestampsMs) {
    if (t > windowStart && t <= ctx.nowMs) count += 1;
  }
  if (count > ctx.maxPerMinute) {
    out.push(
      violation("brightness-rate", `${count} brightness commands in the last minute, max ${ctx.maxPerMinute}`),
    );
  }
}

function checkCloud(ctx: InvariantContext, out: InvariantViolation[]): void {
  for (const t of ctx.transports) {
    if (t.transport === "cloud") {
      out.push(violation("no-cloud-frames", "frame carried over cloud transport", t.deviceId));
    }
  }
}
