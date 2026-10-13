// Unknown firmware policy (T-GOV-17, closes F-GOV-21; spec 147).
//
// Config: govee.lan.stream.maxRearmAttempts (default 3) per
// govee.lan.stream.rearmWindowMs (default 60000).
//
// Normal control continues with the last verified capability; background
// qualification checks run when the show is idle; a diagnostic warning
// appears; a failing raw stream is not retried more than maxRearmAttempts
// per rearmWindowMs; fallback is only ever to a verified capability.
export interface FirmwarePolicyOptions {
  maxRearmAttempts?: number;
  rearmWindowMs?: number;
  clock?: () => number;
}

export type StreamGate = "segmented" | "verified-fallback";

export interface FirmwareDecision {
  gate: StreamGate;
  warning: string | null;
  reason: string;
}

const DEFAULT_MAX_REARM = 3;

const DEFAULT_REARM_WINDOW_MS = 60000;

export class FirmwarePolicy {
  private readonly maxRearm: number;
  private readonly windowMs: number;
  private readonly clock: () => number;
  private readonly rearmAt: number[] = [];
  private lastSeen: number | null = null;

  constructor(options: FirmwarePolicyOptions = {}) {
    const maxRearmAttempts = options.maxRearmAttempts ?? DEFAULT_MAX_REARM;
    this.maxRearm = Number.isFinite(maxRearmAttempts)
      ? Math.max(0, Math.floor(maxRearmAttempts))
      : DEFAULT_MAX_REARM;
    const rearmWindowMs = options.rearmWindowMs ?? DEFAULT_REARM_WINDOW_MS;
    this.windowMs =
      Number.isFinite(rearmWindowMs) && rearmWindowMs > 0 ? rearmWindowMs : DEFAULT_REARM_WINDOW_MS;
    this.clock = options.clock ?? Date.now;
  }

  decide(savedFirmware: string, currentFirmware: string, segmentedVerified: boolean): FirmwareDecision {
    const known =
      currentFirmware !== "" &&
      currentFirmware !== "unmeasured" &&
      currentFirmware === savedFirmware;

    if (known && segmentedVerified) {
      return { gate: "segmented", warning: null, reason: "firmware matches the qualified record" };
    }

    if (currentFirmware === "" || currentFirmware === "unmeasured") {
      return {
        gate: segmentedVerified ? "segmented" : "verified-fallback",
        warning: "firmware unreadable: last verified capability kept, background checks run while the show is idle",
        reason: "firmware unmeasured, treating as unknown per spec 147",
      };
    }

    if (!known) {
      return {
        gate: "verified-fallback",
        warning: `firmware ${currentFirmware} is not the qualified ${savedFirmware}: REQUALIFICATION REQUIRED, normal control on the last verified capability`,
        reason: "unknown firmware, segmented resumes after wizard steps 8, 9, 12, 13",
      };
    }

    return {
      gate: "verified-fallback",
      warning: "segmented channel not verified on this unit: verified fallback only",
      reason: "no verified segmented capability",
    };
  }
  // Sliding-window eviction shared by mayRearm/rearmCount so the budget
  // accounting cannot diverge. A backward clock step (NTP/manual adjustment)
  // would make `now - oldest` negative and freeze eviction, permanently
  // disabling rearm; clamp to the last observed time instead.
  private pruneRearm(now: number): number {
    if (this.lastSeen !== null && now < this.lastSeen) return this.lastSeen;
    this.lastSeen = now;
    while (this.rearmAt.length > 0 && now - this.rearmAt[0]! >= this.windowMs) this.rearmAt.shift();
    return now;
  }

  /** A failing raw stream asks before each re-arm. False means stop spamming. */
  mayRearm(): boolean {
    const now = this.pruneRearm(this.clock());
    if (this.rearmAt.length >= this.maxRearm) return false;
    this.rearmAt.push(now);
    return true;
  }

  rearmCount(): number {
    this.pruneRearm(this.clock());
    return this.rearmAt.length;
  }
}
