// Test support for the T-GOV-10 to T-GOV-13 tests: a datagram-level fake lamp,
// a scripted virtual user, and an independent golden-vector encoder.
//
// The fake speaks the real codec from ./razer.js, so every probe, action and
// wizard test can assert the exact bytes that went out and the exact colours
// that landed. It models the three firmware behaviours T-GOV-10 requires:
//
//   "segmented"        arm and paint work, status and devStatus answer
//   "ignores-paints"   arm and status work, paint is silently swallowed
//   "lan-absent"       nothing answers at all (F-GOV-24)
//
// It is not a hardware claim. Simulator and fake runs prove code, never
// hardware; the owner's HW-GOV-02/03/06 runbooks are what measure units.
import { OPCODE, arm, decodeRaw, encodeRaw, type ScanReply } from "./razer.js";
import type { LanExchange } from "./probe.js";
import type { QualificationUser } from "./qualification.js";

/** Independent protocol encoder for byte assertions: the tests must not use
 *  the production encoder to compute the bytes they expect. */
export function goldenHex(opcode: number, payload: readonly number[]): string {
  const out = [0xbb, (payload.length >> 8) & 0xff, payload.length & 0xff, opcode, ...payload];
  let xor = 0;
  for (const byte of out) xor ^= byte;
  return Buffer.from([...out, xor & 0xff]).toString("hex");
}

export type FakeBehaviour = "segmented" | "ignores-paints" | "lan-absent";

export interface FakeLampOptions {
  device: string;
  ip: string;
  sku: string;
  firmware: string;
  zones: number;
  behaviour: FakeBehaviour;
  armSettleMs?: number;
  /** null disables the ceiling: every paint lands. */
  rateCeilingHz?: number | null;
  answersStatusWhileArmed?: boolean;
  /** How long the unit stays unreachable after a power cycle. */
  reconnectDelayMs?: number;
  /** Initial reported state, for IDENTIFY restore assertions. */
  on?: boolean;
  brightness?: number;
  color?: [number, number, number];
  /** Answer read-backs with text that is not the documented JSON, to prove the
   *  probe still treats the unit as reachable. */
  garbageReplies?: boolean;
}

interface QueuedReply {
  settle: (text: string | null) => void;
}

export class FakeLamp implements LanExchange {
  readonly sentRaw: Uint8Array[] = [];
  readonly sentJson: string[] = [];
  readonly painted: Array<[number, number, number]>;
  readonly options: FakeLampOptions;
  readonly metrics = {
    paintsApplied: 0,
    paintsIgnored: 0,
    paintsDroppedInSettle: 0,
    paintsStuttered: 0,
    statusQueries: 0,
    devStatusQueries: 0,
    armCommands: 0,
    powerCycles: 0,
  };
  /** The zone lit by the last applied single-zone paint, else null. */
  readonly zoneLog: number[] = [];

  armed = false;
  on = true;
  brightness = 100;
  color: [number, number, number] = [255, 255, 255];
  kelvin = 0;
  /** Did the most recent paint attempt land? Step 12's camera answer. */
  lastPaintLanded = false;
  lastPaintReason = "none";
  /** Milliseconds between arming and the last landed paint. */
  landedDelayMs: number | null = null;

  private armedAt = 0;
  private lastPaintAt = 0;
  private offlineUntil = 0;
  private queue: string[] = [];
  private waiters: QueuedReply[] = [];

  constructor(options: FakeLampOptions) {
    this.options = options;
    this.painted = Array.from({ length: options.zones }, () => [0, 0, 0] as [number, number, number]);
    if (options.on !== undefined) this.on = options.on;
    if (options.brightness !== undefined) this.brightness = options.brightness;
    if (options.color !== undefined) this.color = options.color;
  }

  scanReply(): ScanReply {
    return {
      ip: this.options.ip,
      device: this.options.device,
      sku: this.options.sku,
      bleVersionHard: "3.01.01",
      bleVersionSoft: "1.03.01",
      wifiVersionHard: "1.00.10",
      wifiVersionSoft: this.options.firmware,
    };
  }

  private offline(): boolean {
    return Date.now() < this.offlineUntil;
  }

  /** The user pulls the plug and plugs it back in (step 15). */
  powerCycle(): void {
    this.metrics.powerCycles += 1;
    this.armed = false;
    this.on = true;
    this.painted.forEach((_, index) => {
      this.painted[index] = [0, 0, 0];
    });
    this.offlineUntil = Date.now() + (this.options.reconnectDelayMs ?? 0);
  }

  private pushReply(text: string): void {
    const waiter = this.waiters.shift();
    if (waiter !== undefined) {
      waiter.settle(text);
      return;
    }
    this.queue.push(text);
  }

  reply(_deviceId: string, timeoutMs: number): Promise<string | null> {
    if (this.options.behaviour === "lan-absent") return Promise.resolve(null);
    if (this.offline()) {
      // Reachable again once the power cycle finishes: answer nothing until the
      // deadline, like a unit still booting.
      return new Promise<string | null>((resolve) => {
        const timer = setTimeout(() => {
          resolve(null);
        }, Math.max(1, timeoutMs));
        timer.unref?.();
      });
    }
    const queued = this.queue.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    return new Promise<string | null>((resolve) => {
      const waiter: QueuedReply = {
        settle: (text) => {
          clearTimeout(timer);
          resolve(text);
        },
      };
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((entry) => entry !== waiter);
        resolve(null);
      }, Math.max(1, timeoutMs));
      timer.unref?.();
      this.waiters.push(waiter);
    });
  }

  sendJson(_deviceId: string, text: string): void {
    this.sentJson.push(text);
    if (this.options.behaviour === "lan-absent" || this.offline()) return;
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      return;
    }
    if (typeof parsed !== "object" || parsed === null || !("msg" in parsed)) return;
    const msg = parsed.msg;
    if (typeof msg !== "object" || msg === null || !("cmd" in msg)) return;
    const cmd = typeof msg.cmd === "string" ? msg.cmd : "";
    const data = "data" in msg ? msg.data : undefined;
    switch (cmd) {
      case "turn": {
        this.on = typeof data === "object" && data !== null && "value" in data && data.value === 1;
        if (this.armed) this.armed = false;
        return;
      }
      case "brightness": {
        if (typeof data === "object" && data !== null && "value" in data && typeof data.value === "number") {
          this.brightness = Math.min(100, Math.max(1, Math.round(data.value)));
        }
        return;
      }
      case "colorwc": {
        if (typeof data === "object" && data !== null && "color" in data) {
          const color = data.color;
          if (typeof color === "object" && color !== null && "r" in color && "g" in color && "b" in color
            && typeof color.r === "number" && typeof color.g === "number" && typeof color.b === "number") {
            this.color = [color.r, color.g, color.b];
          }
        }
        if (typeof data === "object" && data !== null && "colorTemInKelvin" in data
          && typeof data.colorTemInKelvin === "number") {
          this.kelvin = data.colorTemInKelvin;
        }
        return;
      }
      case "devStatus": {
        this.metrics.devStatusQueries += 1;
        if (this.armed && this.options.answersStatusWhileArmed === false) return;
        if (this.options.garbageReplies === true) {
          this.pushReply("this unit does not answer in the documented shape");
          return;
        }
        this.pushReply(JSON.stringify({
          msg: {
            cmd: "devStatus",
            data: {
              onOff: this.on ? 1 : 0,
              brightness: this.brightness,
              color: { r: this.color[0], g: this.color[1], b: this.color[2] },
              colorTemInKelvin: this.kelvin,
            },
          },
        }));
        return;
      }
      case "status": {
        this.metrics.statusQueries += 1;
        if (this.armed && this.options.answersStatusWhileArmed === false) return;
        if (this.options.garbageReplies === true) {
          this.pushReply("this unit does not answer in the documented shape");
          return;
        }
        const b2 = encodeRaw(OPCODE.ARM_STATUS, Uint8Array.from([this.armed ? 1 : 0]));
        this.pushReply(JSON.stringify({
          msg: {
            cmd: "status",
            data: {
              onOff: this.on ? 1 : 0,
              brightness: this.brightness,
              pt: Buffer.from(b2).toString("base64"),
            },
          },
        }));
        return;
      }
      default:
        return;
    }
  }

  sendRaw(_deviceId: string, raw: Uint8Array): void {
    this.sentRaw.push(raw.slice());
    if (this.options.behaviour === "lan-absent" || this.offline()) return;
    const decoded = decodeRaw(raw);
    if (decoded === null) return;
    if (decoded.opcode === OPCODE.ARM) {
      this.metrics.armCommands += 1;
      this.armed = (decoded.payload[0] ?? 0) === 1;
      if (this.armed) {
        this.armedAt = Date.now();
        this.landedDelayMs = null;
      }
      this.lastPaintLanded = false;
      return;
    }
    if (decoded.opcode === OPCODE.RGB_STREAM || decoded.opcode === OPCODE.ZONED) {
      this.applyPaint(decoded.payload, decoded.opcode);
    }
  }

  private applyPaint(payload: Uint8Array, opcode: number): void {
    this.lastPaintLanded = false;
    if (!this.armed) {
      this.metrics.paintsIgnored += 1;
      this.lastPaintReason = "not-armed";
      return;
    }
    if (this.options.behaviour === "ignores-paints") {
      this.metrics.paintsIgnored += 1;
      this.lastPaintReason = "ignored";
      return;
    }
    const elapsed = Date.now() - this.armedAt;
    if (elapsed < (this.options.armSettleMs ?? 50)) {
      this.metrics.paintsDroppedInSettle += 1;
      this.lastPaintReason = "settle";
      return;
    }
    const ceiling = this.options.rateCeilingHz ?? null;
    if (ceiling !== null && this.lastPaintAt > 0 && Date.now() - this.lastPaintAt < (1000 / ceiling) * 0.85) {
      // 0.85: a real unit drops paints that arrive past its ceiling, but any
      // timer under load drifts a few percent. The fake only calls a paint
      // "too fast" when it is clearly under the ceiling interval, so the rate
      // sweep test does not turn timer jitter into a measurement.
      this.metrics.paintsStuttered += 1;
      this.lastPaintReason = "stutter";
      return;
    }
    this.lastPaintAt = Date.now();
    let litZone: number | null = null;
    const nbSeg = payload[1] ?? 0;
    if (opcode === OPCODE.RGB_STREAM) {
      for (let index = 0; index < nbSeg && index < this.painted.length; index++) {
        const zone: [number, number, number] = [payload[2 + index * 3] ?? 0, payload[2 + index * 3 + 1] ?? 0, payload[2 + index * 3 + 2] ?? 0];
        const lit = zone[0] > 0 || zone[1] > 0 || zone[2] > 0;
        if (lit) litZone = litZone === null ? index : -1;
        this.painted[index] = zone;
      }
    } else {
      for (let index = 0; index < nbSeg; index++) {
        const zone = payload[2 + index * 4 + 3] ?? 0;
        const colour: [number, number, number] = [payload[2 + index * 4] ?? 0, payload[2 + index * 4 + 1] ?? 0, payload[2 + index * 4 + 2] ?? 0];
        if (zone < this.painted.length) this.painted[zone] = colour;
        if (colour[0] > 0 || colour[1] > 0 || colour[2] > 0) litZone = litZone === null ? zone : -1;
      }
    }
    this.zoneLog.push(litZone ?? -1);
    this.metrics.paintsApplied += 1;
    this.lastPaintLanded = true;
    this.lastPaintReason = "applied";
    this.landedDelayMs = elapsed;
  }
}

/** Put a fake into the armed state the way a caller arms a unit. */
export function armLamp(lamp: FakeLamp, on = true): void {
  lamp.sendRaw(lamp.options.device, arm(on));
}

/** Number of contiguous runs of the same non-black colour: what a user counts
 *  as distinct bands. */
export function countDistinctBands(painted: readonly (readonly [number, number, number])[]): number {
  let bands = 0;
  let previous: string | null = null;
  for (const zone of painted) {
    const lit = zone[0] > 0 || zone[1] > 0 || zone[2] > 0;
    const key = lit ? `${zone[0]},${zone[1]},${zone[2]}` : null;
    if (key !== null && key !== previous) bands += 1;
    previous = key;
  }
  return bands;
}

export interface ScriptedAnswers {
  identifyConfirmed?: boolean;
  endFirst?: "index-zero" | "index-last" | "unclear";
  orientation?: "forward" | "reverse";
  /** null models a user who skips the latency test. */
  latency?: { valueMs: number; method: "camera" | "tap" } | null;
}

/**
 * The scripted virtual user of `P-52-wizard`: confirmations and direction
 * answers come from the test, while the camera steps read what the fake lamp
 * actually rendered and how many paints it dropped.
 */
export class ScriptedUser implements QualificationUser {
  private stutterSnapshot = 0;

  constructor(private readonly lamp: FakeLamp, private readonly answers: ScriptedAnswers = {}) {}

  confirmIdentify(): Promise<boolean> {
    return Promise.resolve(this.answers.identifyConfirmed ?? true);
  }

  confirmPaint(_pattern: "B0-two-colour" | "B4-zoned"): Promise<boolean> {
    return Promise.resolve(countDistinctBands(this.lamp.painted) >= 2);
  }

  seesDistinctBands(candidateZones: number): Promise<boolean> {
    return Promise.resolve(countDistinctBands(this.lamp.painted) === candidateZones);
  }

  whichEndFirst(): Promise<"index-zero" | "index-last" | "unclear"> {
    return Promise.resolve(this.answers.endFirst ?? "index-zero");
  }

  chooseOrientation(): Promise<"forward" | "reverse"> {
    return Promise.resolve(this.answers.orientation ?? "forward");
  }

  confirmPaintLanded(_delayMs: number): Promise<boolean> {
    return Promise.resolve(this.lamp.lastPaintLanded);
  }

  markStutter(_rateHz: number): Promise<boolean> {
    const dropped = this.lamp.metrics.paintsStuttered;
    const stuttered = dropped > this.stutterSnapshot;
    this.stutterSnapshot = dropped;
    return Promise.resolve(stuttered);
  }

  measureLatencyMs(): Promise<{ valueMs: number; method: "camera" | "tap" } | null> {
    if (this.answers.latency === undefined) return Promise.resolve({ valueMs: 25, method: "camera" });
    return Promise.resolve(this.answers.latency);
  }

  powerCycled(): Promise<void> {
    this.lamp.powerCycle();
    return Promise.resolve();
  }
}
