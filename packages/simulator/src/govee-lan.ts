// Govee LAN device simulator (T-GOV-14, WP03 traps, spec 104).
// Provenance: govee-toolkit MIT (Damien Thery, v0.5.0), docs/protocol/lan.md
// sections 1 (consecutive commands), Latency notes, 2.1 to 2.3 and 2.7.
// A virtual lamp on loopback UDP: answers scan, the four official commands,
// devStatus, razer arm/paint (B0 and B4), disarm, and status with B2.
// Configurable traps mirror real hardware: third back-to-back datagram
// dropped, turn ends the channel, white colorwc ends the channel, no status
// while armed, rate ceiling with stutter, arm settle, loss, latency, jitter,
// duplication, reorder, disappearance, IP change. Rendered zone colors stay
// readable for assertions and the Simulator mode preview. No claim is made
// about hardware. Simulator runs prove code, never hardware.
import { createSocket, type RemoteInfo, type Socket } from "node:dgram";
import { OPCODE, decodeRaw } from "@autolight/govee";

export interface SimDeviceProfile {
  device: string;
  sku: string;
  zones: number;
  armSettleMs?: number;
  maxHzByZones?: Record<number, number>;
}

export interface SimFaults {
  dropBackToBackThird?: boolean;
  turnEndsChannel?: boolean;
  whiteEndsChannel?: boolean;
  silentStatusWhileArmed?: boolean;
  rateCeiling?: boolean;
  armSettle?: boolean;
  lossEvery?: number;
  latencyMs?: number;
  jitterMs?: number;
  duplicateEvery?: number;
  reorderEvery?: number;
  disappearAt?: number;
  reappearAt?: number;
  changedIp?: string;
}

const DEFAULT_FAULTS: Required<SimFaults> = {
  dropBackToBackThird: true,
  turnEndsChannel: true,
  whiteEndsChannel: true,
  silentStatusWhileArmed: true,
  rateCeiling: true,
  armSettle: true,
  lossEvery: 0,
  latencyMs: 0,
  jitterMs: 0,
  duplicateEvery: 0,
  reorderEvery: 0,
  disappearAt: -1,
  reappearAt: -1,
  changedIp: "",
};

function maxHz(zones: number, table?: Record<number, number>): number {
  if (table) {
    let best = 10;
    for (const [k, v] of Object.entries(table)) {
      if (zones >= Number(k)) best = v;
    }
    return best;
  }
  if (zones <= 20) return 40;
  if (zones <= 60) return 25;
  if (zones <= 120) return 20;
  return 10;
}

export interface SimMetrics {
  datagrams: number;
  droppedBackToBack: number;
  droppedLoss: number;
  paintsApplied: number;
  paintsStuttered: number;
  statusQueries: number;
}

export class GoveeLanSim {
  private socket: Socket | null = null;
  private port = 0;
  private on = true;
  private brightness = 100;
  private color: [number, number, number] = [255, 255, 255];
  private kelvin = 0;
  private armed = false;
  private armedAt = 0;
  private paintCount = 0;
  private backToBack = 0;
  private packetCount = 0;
  private lastPaintAt = 0;
  private hold: { msg: string; at: number } | null = null;
  readonly rendered: Array<[number, number, number]>;
  readonly metrics: SimMetrics = {
    datagrams: 0, droppedBackToBack: 0, droppedLoss: 0,
    paintsApplied: 0, paintsStuttered: 0, statusQueries: 0,
  };
  readonly faults: Required<SimFaults>;
  readonly profile: Required<Pick<SimDeviceProfile, "device" | "sku" | "zones">> &
    Pick<SimDeviceProfile, "armSettleMs" | "maxHzByZones">;

  constructor(profile: SimDeviceProfile, faults: SimFaults = {}) {
    this.profile = { armSettleMs: 50, ...profile };
    this.faults = { ...DEFAULT_FAULTS, ...faults };
    this.rendered = Array.from({ length: profile.zones }, () => [0, 0, 0] as [number, number, number]);
  }

  get armedState(): boolean {
    return this.armed;
  }

  get ceilingHz(): number {
    return maxHz(this.profile.zones, this.profile.maxHzByZones);
  }

  async start(port = 0): Promise<number> {
    const { promise, resolve, reject } = Promise.withResolvers<{ sock: Socket; port: number }>();
    const sock = createSocket("udp4");
    sock.on("error", (err) => reject(err));
    sock.on("message", (msg, rinfo) => {
      void this.handle(msg, rinfo).catch(() => undefined);
    });
    sock.bind(port, "127.0.0.1", () => {
      const addr = sock.address();
      resolve({ sock, port: typeof addr === "object" ? addr.port : port });
    });
    const { sock: s, port: p } = await promise;
    this.socket = s;
    this.port = p;
    return p;
  }

  async stop(): Promise<void> {
    const { promise, resolve } = Promise.withResolvers<void>();
    if (this.socket) {
      const s = this.socket;
      this.socket = null;
      s.close(() => resolve());
      await promise;
    }
  }

  get controlPort(): number {
    return this.port;
  }

  replyIp(): string {
    if (this.faults.changedIp && this.packetCount >= this.faults.reappearAt && this.faults.reappearAt >= 0) {
      return this.faults.changedIp;
    }
    return "127.0.0.1";
  }

  private gone(): boolean {
    const { disappearAt, reappearAt } = this.faults;
    if (disappearAt < 0) return false;
    if (this.packetCount < disappearAt) return false;
    if (reappearAt >= 0 && this.packetCount >= reappearAt) return false;
    return true;
  }

  private send(text: string, rinfo: RemoteInfo): void {
    if (!this.socket || this.gone()) return;
    const delay = this.faults.latencyMs + (this.faults.jitterMs > 0
      ? (this.packetCount % 3) * this.faults.jitterMs / 2
      : 0);
    const deliver = (): void => {
      this.socket?.send(text, rinfo.port, rinfo.address, () => undefined);
      if (this.faults.duplicateEvery > 0 && this.packetCount % this.faults.duplicateEvery === 0) {
        this.socket?.send(text, rinfo.port, rinfo.address, () => undefined);
      }
    };
    if (delay > 0) {
      const timer = setTimeout(deliver, delay);
      timer.unref?.();
    } else {
      deliver();
    }
  }

  private async handle(msg: Buffer, rinfo: RemoteInfo): Promise<void> {
    this.packetCount += 1;
    this.metrics.datagrams += 1;
    if (this.gone()) return;
    if (this.faults.lossEvery > 0 && this.packetCount % this.faults.lossEvery === 0) {
      this.metrics.droppedLoss += 1;
      return;
    }
    if (this.faults.reorderEvery > 0 && this.packetCount % this.faults.reorderEvery === 0) {
      const text = msg.toString();
      if (this.hold) {
        const held = this.hold;
        this.hold = { msg: text, at: Date.now() };
        await this.dispatch(held.msg, rinfo);
        const cur = this.hold;
        this.hold = null;
        if (cur) await this.dispatch(cur.msg, rinfo);
      } else {
        this.hold = { msg: text, at: Date.now() };
        const timer = setTimeout(() => {
          const cur = this.hold;
          this.hold = null;
          if (cur && this.socket) void this.dispatch(cur.msg, rinfo).catch(() => undefined);
        }, 5);
        timer.unref?.();
      }
      return;
    }
    await this.dispatch(msg.toString(), rinfo);
  }

  private async dispatch(text: string, rinfo: RemoteInfo): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return;
    }
    if (typeof parsed !== "object" || parsed === null || !("msg" in parsed)) return;
    const envelopeMsg = parsed as { msg: { cmd?: unknown; data?: unknown } };
    const cmd = envelopeMsg.msg.cmd;
    if (cmd === "scan") {
      this.backToBack = 0;
      this.send(JSON.stringify({
        msg: {
          cmd: "scan",
          data: {
            ip: this.replyIp(), device: this.profile.device, sku: this.profile.sku,
            bleVersionHard: "3.01.01", bleVersionSoft: "1.03.01",
            wifiVersionHard: "1.00.10", wifiVersionSoft: "1.02.03",
          },
        },
      }), rinfo);
      return;
    }
    if (cmd === "razer") {
      await this.handleRazer(envelopeMsg.msg.data);
      return;
    }
    this.backToBack += 1;
    if (this.faults.dropBackToBackThird && this.backToBack >= 3) {
      this.metrics.droppedBackToBack += 1;
      this.backToBack = 0;
      return;
    }
    if (cmd === "turn") {
      const value = (envelopeMsg.msg.data as { value?: unknown } | undefined)?.value;
      this.on = value === 1;
      if (this.armed && this.faults.turnEndsChannel) this.armed = false;
      return;
    }
    if (cmd === "brightness") {
      const value = (envelopeMsg.msg.data as { value?: unknown } | undefined)?.value;
      if (typeof value === "number") this.brightness = Math.min(100, Math.max(1, Math.round(value)));
      return;
    }
    if (cmd === "colorwc") {
      const data = envelopeMsg.msg.data as
        | { color?: { r?: number; g?: number; b?: number }; colorTemInKelvin?: number }
        | undefined;
      const c = data?.color;
      if (c && typeof c.r === "number" && typeof c.g === "number" && typeof c.b === "number") {
        this.color = [c.r, c.g, c.b];
      }
      this.kelvin = typeof data?.colorTemInKelvin === "number" ? data.colorTemInKelvin : 0;
      if (this.armed && this.faults.whiteEndsChannel && this.kelvin !== 0) this.armed = false;
      this.backToBack = 0;
      return;
    }
    if (cmd === "devStatus") {
      this.backToBack = 0;
      this.metrics.statusQueries += 1;
      if (this.armed && this.faults.silentStatusWhileArmed) return;
      this.send(JSON.stringify({
        msg: {
          cmd: "devStatus",
          data: {
            onOff: this.on ? 1 : 0, brightness: this.brightness,
            color: { r: this.color[0], g: this.color[1], b: this.color[2] },
            colorTemInKelvin: this.kelvin,
          },
        },
      }), rinfo);
      return;
    }
    if (cmd === "status") {
      this.backToBack = 0;
      this.metrics.statusQueries += 1;
      if (this.armed && this.faults.silentStatusWhileArmed) return;
      this.send(JSON.stringify({
        msg: {
          cmd: "status",
          data: {
            onOff: this.on ? 1 : 0, brightness: this.brightness,
            pt: Buffer.from(new Uint8Array([0xbb, 0, 1, OPCODE.ARM_STATUS, this.armed ? 1 : 0,
              0xbb ^ 0 ^ 1 ^ OPCODE.ARM_STATUS ^ (this.armed ? 1 : 0)])).toString("base64"),
          },
        },
      }), rinfo);
      return;
    }
  }

  private async handleRazer(data: unknown): Promise<void> {
    const pt = (data as { pt?: unknown } | undefined)?.pt;
    if (typeof pt !== "string" || pt.length === 0) return;
    let raw: Uint8Array;
    try {
      raw = new Uint8Array(Buffer.from(pt, "base64"));
    } catch {
      return;
    }
    const decoded = decodeRaw(raw);
    if (!decoded) return;
    if (decoded.opcode === OPCODE.ARM) {
      this.armed = (decoded.payload[0] ?? 0) === 1;
      this.armedAt = Date.now();
      this.paintCount = 0;
      this.lastPaintAt = 0;
      return;
    }
    if (decoded.opcode === OPCODE.RGB_STREAM || decoded.opcode === OPCODE.ZONED) {
      this.applyPaint(decoded.payload, decoded.opcode);
    }
  }

  private applyPaint(payload: Uint8Array, opcode: number): void {
    if (!this.armed || payload.length < 2) return;
    if (this.faults.armSettle && Date.now() - this.armedAt < (this.profile.armSettleMs ?? 50)) return;
    this.paintCount += 1;
    if (this.faults.rateCeiling) {
      const minGap = 1000 / this.ceilingHz;
      const now = Date.now();
      if (this.lastPaintAt > 0 && now - this.lastPaintAt < minGap) {
        this.metrics.paintsStuttered += 1;
        return;
      }
      this.lastPaintAt = now;
    }
    const nbSeg = payload[1] ?? 0;
    if (opcode === OPCODE.RGB_STREAM) {
      for (let i = 0; i < nbSeg && i < this.rendered.length; i++) {
        this.rendered[i] = [payload[2 + i * 3] ?? 0, payload[2 + i * 3 + 1] ?? 0, payload[2 + i * 3 + 2] ?? 0];
      }
    } else {
      for (let i = 0; i < nbSeg; i++) {
        const zone = payload[2 + i * 4 + 3] ?? 0;
        if (zone < this.rendered.length) {
          this.rendered[zone] = [payload[2 + i * 4] ?? 0, payload[2 + i * 4 + 1] ?? 0, payload[2 + i * 4 + 2] ?? 0];
        }
      }
    }
    this.metrics.paintsApplied += 1;
  }
}

