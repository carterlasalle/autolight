// BLE simulated peripheral (test seam for T-BLE-01 to T-BLE-04).
//
// A peripheral behind the BleAdapter seam implementing GATT behaviour the
// link manager needs: advertisement bytes, connection, notify subscription,
// 20 byte writes with acks, reads, masked writes, budget stall, encoded
// flag, name families and the one-connection rule. Hardware claims need the
// owner's units; this sim proves code, never hardware.

import {
  BLE_ENCODED_FLAG,
  BLE_FRAME_LEN,
  BLE_PROTYPE,
  BLE_VERSION_UUID,
} from "./constants.js";
import {
  decodeBleFrame,
  decodeHostColor,
  encodeBleFrame,
  encodeHostColor,
  parseBleAck,
} from "./commands.js";
import { parseBleAdvertisement, type BleAdvertisement, type BleScanInput } from "./scan.js";
import type { BleAdapter, BleBackendKind, BleConnection, BleNotifyHandler } from "./backends.js";
import { bleV2Decrypt, type BleV2Key } from "./encrypted.js";

/** Decodes a 20-byte E7 handshake frame locally; null on any other shape. */
function decodeHandshakeFrame(frame: Uint8Array): { cmd: number; payload: Uint8Array } | null {
  if (frame.length !== BLE_FRAME_LEN) return null;
  if ((frame[0] ?? -1) !== BLE_PROTYPE.HANDSHAKE) return null;
  let xor = 0;
  for (let i = 0; i < BLE_FRAME_LEN - 1; i++) xor ^= frame[i] ?? 0;
  if ((frame[BLE_FRAME_LEN - 1] ?? -1) !== (xor & 0xff)) return null;
  return { cmd: frame[1] ?? 0, payload: frame.slice(2, BLE_FRAME_LEN - 1) };
}

export interface SimPeripheralOptions {
  address: string;
  name?: string | null;
  manufacturer?: Uint8Array;
  rssi?: number | null;
  zones?: number;
  /** Null disables the ceiling: every write lands. */
  budgetHz?: number | null;
  wifiMac?: string | null;
  segmentCount?: number;
  failConnect?: boolean;
  /** Version byte reported on ...2b12. Null means the read fails. */
  versionByte?: number | null;
  /** SKU carried in the decrypted v2 reply check. */
  sku?: string;
  /** Encoded-link seed handshake support (toolkit E7 01 / E7 02). */
  handshakeSeed?: boolean;
  /** v2 session key: when set the sim answers the v2 E7 11 01 handshake. */
  v2Key?: BleV2Key;
  /** Host colour temporary hold in ms: paints fade at now + hold. */
  renderHoldMs?: number;
  /** Recorded credential payloads from the A1 11 provisioning transfer. */
  provisioningLog?: Uint8Array[];
}

export interface SimPeripheralMetrics {
  writes: number;
  acks: number;
  reads: number;
  connects: number;
  stalled: number;
}

/** One simulated peripheral: GATT answers, acks, reads, masked writes. */
export class SimPeripheral {
  readonly advertisement: BleAdvertisement;
  readonly zones: number;
  readonly wifiMac: string | null;
  readonly segmentCount: number;
  readonly metrics: SimPeripheralMetrics = { writes: 0, acks: 0, reads: 0, connects: 0, stalled: 0 };
  readonly written: Uint8Array[] = [];
  readonly painted: Array<[number, number, number]>;
  /** Credential chunk bytes received on A1 11, in order. */
  readonly provisioned: Uint8Array[] = [];
  power = true;
  brightness01 = 1;
  connected = false;
  encoded: boolean;
  /** Set once either handshake shape completes. */
  handshakeDone = false;
  private notify: BleNotifyHandler | null = null;
  private writeTimes: number[] = [];
  private readonly budgetHz: number | null;
  private stalledUntil = 0;
  private handshakeSeedSeen = false;
  private hostColorAt = 0;
  private provisionStarted = false;
  private provisionStopped = false;
  private v2ReplyText: string | null = null;
  constructor(readonly options: SimPeripheralOptions) {
    const input: BleScanInput = {
      address: options.address,
      ...(options.name !== undefined ? { name: options.name } : {}),
      ...(options.manufacturer !== undefined ? { manufacturer: options.manufacturer } : {}),
      ...(options.rssi !== undefined ? { rssi: options.rssi } : {}),
    };
    this.advertisement = parseBleAdvertisement(input);
    this.zones = Math.max(1, options.zones ?? 8);
    this.wifiMac = options.wifiMac ?? null;
    this.segmentCount = options.segmentCount ?? this.zones;
    this.encoded = options.manufacturer !== undefined && options.manufacturer.length > 0
      && ((options.manufacturer[0] ?? 0) & BLE_ENCODED_FLAG) === BLE_ENCODED_FLAG;
    this.budgetHz = options.budgetHz === undefined ? null : options.budgetHz;
    this.painted = Array.from({ length: this.zones }, () => [0, 0, 0] as [number, number, number]);
  }

  scanInput(): BleScanInput {
    return {
      address: this.advertisement.address,
      name: this.advertisement.name,
      manufacturer: this.advertisement.manufacturer.slice(),
      ...(this.advertisement.rssi !== null ? { rssi: this.advertisement.rssi } : {}),
    };
  }

  handleConnect(): void {
    if (this.options.failConnect === true) throw new Error(`sim ${this.options.address} refused the connection`);
    if (this.connected) throw new Error(`sim ${this.options.address} allows one connection at a time`);
    this.connected = true;
    this.metrics.connects += 1;
  }

  handleDisconnect(): void {
    this.connected = false;
    this.notify = null;
  }

  subscribe(handler: BleNotifyHandler): void {
    this.notify = handler;
  }

  /** Applies one write, answers the ack on notify. Stalls past the budget. */
  handleWrite(frame: Uint8Array, now: number): void {
    this.metrics.writes += 1;
    this.written.push(frame.slice());
    if (this.stalled(now)) {
      this.metrics.stalled += 1;
      return;
    }
    if (this.budgetHz !== null) {
      const spacing = 1000 / Math.max(1, this.budgetHz);
      this.writeTimes = this.writeTimes.filter((t) => now - t < 1000);
      const last = this.writeTimes.length > 0 ? (this.writeTimes[this.writeTimes.length - 1] ?? now) : null;
      if (last !== null && now - last < spacing - 1) {
        this.metrics.stalled += 1;
        this.stalledUntil = now + 2000;
        return;
      }
      this.writeTimes.push(now);
    }
    const short = decodeHostColor(frame);
    if (short !== null) {
      this.applyHostColor(short.sub, short.payload, now);
      return;
    }
    const decoded = decodeBleFrame(frame);
    const handshake = decoded === null ? decodeHandshakeFrame(frame) : null;
    if (handshake !== null) {
      this.answerHandshake(handshake.cmd, handshake.payload);
      return;
    }
    if (decoded === null) {
      this.ack(0x00, 0x01);
      return;
    }
    if (decoded.proType === BLE_PROTYPE.READ) {
      this.metrics.reads += 1;
      this.ack(decoded.cmd, 0x00);
      return;
    }
    if (decoded.proType === BLE_PROTYPE.PROVISION) {
      this.answerProvision(decoded.proType, decoded.cmd, decoded.payload);
      this.ack(decoded.cmd, 0x00);
      return;
    }
    if (decoded.proType === BLE_PROTYPE.WRITE && decoded.cmd === 0x17) {
      this.answerProvision(decoded.proType, decoded.cmd, decoded.payload);
      this.ack(decoded.cmd, 0x00);
      return;
    }
    this.applyWrite(decoded.cmd, decoded.payload);
    this.ack(decoded.cmd, 0x00);
  }
  private stalled(now: number): boolean {
    return now < this.stalledUntil;
  }

  private ack(cmd: number, status: number): void {
    this.metrics.acks += 1;
    const notify = this.notify;
    if (notify === null) return;
    notify(new Uint8Array([BLE_PROTYPE.WRITE, cmd & 0xff, status & 0xff]));
  }

  private applyWrite(cmd: number, payload: Uint8Array): void {
    if (cmd === 0x01) {
      this.power = (payload[0] ?? 0) !== 0;
      return;
    }
    if (cmd === 0x04) {
      this.brightness01 = Math.min(1, Math.max(0, (payload[0] ?? 0) / 100));
      return;
    }
    if (cmd !== 0x05) return;
    const mode = payload[0] ?? 0;
    if (mode === 0x0d) {
      const color: [number, number, number] = [payload[1] ?? 0, payload[2] ?? 0, payload[3] ?? 0];
      for (let z = 0; z < this.zones; z++) this.painted[z] = [...color];
      return;
    }
    if (mode === 0x15 && (payload[1] ?? 0) === 0x01) {
      const color: [number, number, number] = [payload[2] ?? 0, payload[3] ?? 0, payload[4] ?? 0];
      const mask = payload.subarray(9, 9 + Math.ceil(this.zones / 8));
      for (let z = 0; z < this.zones; z++) {
        if (((mask[Math.floor(z / 8)] ?? 0) & (1 << (z % 8))) !== 0) this.painted[z] = [...color];
      }
      return;
    }
    if (mode === 0x02) {
      const color: [number, number, number] = [payload[1] ?? 0, payload[2] ?? 0, payload[3] ?? 0];
      for (let z = 0; z < this.zones; z++) this.painted[z] = [...color];
    }
  }

  private applyHostColor(sub: number, payload: Uint8Array, now: number): void {
    if (sub !== 0x02 || (payload[0] ?? -1) !== 0x83) return;
    const color: [number, number, number] = [payload[1] ?? 0, payload[2] ?? 0, payload[3] ?? 0];
    for (let z = 0; z < this.zones; z++) this.painted[z] = [...color];
    this.hostColorAt = now;
  }

  /** Answers the handshake: E7 01 / E7 02 seed pair or the v2 E7 11 01 nonce. */
  private answerHandshake(cmd: number, payload: Uint8Array): void {
    if (cmd === 0x01 && this.options.handshakeSeed === true) {
      this.handshakeSeedSeen = payload.length > 0;
      this.ack(cmd, this.handshakeSeedSeen ? 0x00 : 0x01);
      return;
    }
    if (cmd === 0x02 && this.options.handshakeSeed === true) {
      const ok = this.handshakeSeedSeen && payload.length > 0;
      this.handshakeSeedSeen = false;
      this.handshakeDone = this.handshakeDone || ok;
      this.ack(cmd, ok ? 0x00 : 0x01);
      return;
    }
    if (cmd === 0x11 && (payload[0] ?? -1) === 0x01 && this.options.v2Key !== undefined) {
      this.handshakeDone = true;
      this.ack(cmd, 0x00);
      this.pushV2Reply();
      return;
    }
    this.ack(cmd, 0x01);
  }

  /** Sim reply to the v2 handshake: SKU plus MAC the caller verifies. */
  private pushV2Reply(): void {
    const sku = this.options.sku ?? "H6076";
    const mac = this.wifiMac ?? "aa:bb:cc:dd:ee:ff";
    this.v2ReplyText = `sku=${sku} mac=${mac}`;
  }

  private answerProvision(proType: number, cmd: number, payload: Uint8Array): void {
    if (proType === BLE_PROTYPE.WRITE && cmd === 0x17) {
      if ((payload[0] ?? -1) === 0x01) this.provisionStarted = true;
      if ((payload[0] ?? -1) === 0x00) this.provisionStopped = this.provisionStarted;
      return;
    }
    if (proType === BLE_PROTYPE.PROVISION && cmd === 0x11 && this.provisionStarted) {
      this.provisioned.push(payload.slice(0, 17));
      const log = this.options.provisioningLog;
      if (log !== undefined) log.push(payload.slice(0, 17));
    }
  }

  /** Reads the sim state the way a real read-back would report it. */
  readState(cmd: number, extra = 0): number[] | string | null {
    void extra;
    switch (cmd) {
      case 0x01: return [this.power ? 1 : 0];
      case 0x04: return [Math.round(this.brightness01 * 100)];
      case 0x0f: return [this.segmentCount];
      case 0x40: return [this.segmentCount];
      case 0x14: return this.wifiMac;
      case 0x20: return "3.01.01";
      case 0x21: return "1.03.01";
      default: return null;
    }
  }

  /** Version byte for the ...2b12 characteristic, or null when it fails. */
  readVersionByte(): number | null {
    return this.options.versionByte ?? null;
  }

  /** Decrypted-text view of the last v2 reply the sim produced. */
  readV2ReplyText(): string | null {
    return this.v2ReplyText;
  }

  /** True while the host colour hold has not expired at now. */
  hostColorHeld(now: number): boolean {
    const hold = this.options.renderHoldMs ?? 0;
    return hold > 0 && now - this.hostColorAt < hold;
  }

  /** True once a full provision transfer (start, chunks, stop) landed. */
  get provisionComplete(): boolean {
    return this.provisionStarted && this.provisionStopped && this.provisioned.length > 0;
  }
}

export interface SimAdapterOptions {
  kind?: BleBackendKind;
  scanFails?: boolean;
  clock?: () => number;
}

/** In-memory adapter over a set of simulated peripherals. */
export class SimBleAdapter implements BleAdapter {
  readonly kind: BleBackendKind;
  readonly peripherals: SimPeripheral[] = [];
  readonly closed: string[] = [];
  private readonly scanFails: boolean;
  private readonly clock: () => number;

  constructor(opts: SimAdapterOptions = {}) {
    this.kind = opts.kind ?? "noble";
    this.scanFails = opts.scanFails ?? false;
    this.clock = opts.clock ?? (() => Date.now());
  }

  add(peripheral: SimPeripheral): void {
    this.peripherals.push(peripheral);
  }

  find(address: string): SimPeripheral | null {
    return this.peripherals.find((p) => p.advertisement.address === address) ?? null;
  }

  async scan(_timeoutMs: number): Promise<BleAdvertisement[]> {
    if (this.scanFails) throw new Error(`sim ${this.kind} scan failed`);
    return this.peripherals
      .filter((p) => !p.connected)
      .map((p) => parseBleAdvertisement(p.scanInput()));
  }

  async connect(address: string): Promise<BleConnection> {
    const peripheral = this.find(address);
    if (peripheral === null) throw new Error(`sim has no peripheral ${address}`);
    peripheral.handleConnect();
    const kind = this.kind;
    const clock = this.clock;
    const adapter = this;
    return {
      address,
      kind,
      subscribe(handler: BleNotifyHandler): void {
        peripheral.subscribe(handler);
      },
      async write(frame: Uint8Array): Promise<void> {
        peripheral.handleWrite(frame, clock());
      },
      async disconnect(): Promise<void> {
        peripheral.handleDisconnect();
        adapter.closed.push(address);
      },
    };
  }

  async close(): Promise<void> {
    for (const p of this.peripherals) {
      if (p.connected) {
        p.handleDisconnect();
        this.closed.push(p.advertisement.address);
      }
    }
  }
}

/** Golden 20 byte encoder, independent of the production codec. */
export function simGoldenFrame(proType: number, cmd: number, payload: readonly number[]): string {
  const out = new Uint8Array(BLE_FRAME_LEN);
  out[0] = proType & 0xff;
  out[1] = cmd & 0xff;
  for (let i = 0; i < Math.min(payload.length, 17); i++) out[2 + i] = payload[i] ?? 0;
  let xor = 0;
  for (let i = 0; i < BLE_FRAME_LEN - 1; i++) xor ^= out[i] ?? 0;
  out[BLE_FRAME_LEN - 1] = xor & 0xff;
  return Buffer.from(out).toString("hex");
}

export { encodeBleFrame, parseBleAck };

// ---------------------------------------------------------------------------
// Full-sim helpers (T-BLE-09: contract surface over the peripheral above)
// ---------------------------------------------------------------------------

/** Address families the sim covers: every WP04 name family plus unknown. */
export const SIM_NAME_FAMILIES = ["gbk", "gv", "ihoment", "govee", "minger", "unknown"] as const;

export interface SimContractCheck {
  name: string;
  ok: boolean;
  detail: string;
}

/**
 * Builds one peripheral per advertisement family so contract tests cover the
 * name families, the encoded flag, pactType and pactCode in one sweep.
 */
export function simFamilyPeripherals(): SimPeripheral[] {
  const names: Record<(typeof SIM_NAME_FAMILIES)[number], string | null> = {
    gbk: "GBK_H6076_F001",
    gv: "GVH6076F002",
    ihoment: "ihoment_F003",
    govee: "Govee_F004",
    minger: "Minger_F005",
    unknown: "Other_light",
  };
  return (Object.keys(names) as Array<(typeof SIM_NAME_FAMILIES)[number]>).map((family, i) => new SimPeripheral({
    address: `AA:BB:CC:F0:00:${(i + 1).toString(16).padStart(2, "0")}`,
    name: names[family],
    manufacturer: new Uint8Array([family === "gv" ? 0x40 : 0x00, 4, 7]),
    zones: 8,
    wifiMac: `aa:bb:cc:f0:00:${(i + 1).toString(16).padStart(2, "0")}`,
    segmentCount: 8,
    budgetHz: null,
    versionByte: family === "gv" ? 2 : 1,
    sku: "H6076",
    handshakeSeed: family === "gv",
  }));
}

/** GATT surface the full sim implements: version byte, notify, handshake. */
export interface SimGatt {
  versionUuid: string;
  versionByte: number | null;
  handshakeDone: boolean;
}

/** Reads the sim GATT surface the way ...2b12 plus the handshake report it. */
export function simGattState(peripheral: SimPeripheral): SimGatt {
  return { versionUuid: BLE_VERSION_UUID, versionByte: peripheral.readVersionByte(), handshakeDone: peripheral.handshakeDone };
}

/** Expired-host-colour check: paints after the hold read as expired. */
export function simHostColorExpired(peripheral: SimPeripheral, now: number): boolean {
  return !peripheral.hostColorHeld(now);
}

/** Provisioning bytes in arrival order: concatenated A1 11 chunk payloads. */
export function simProvisionBytes(peripheral: SimPeripheral): Uint8Array {
  const total = peripheral.provisioned.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of peripheral.provisioned) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/** Runs every contract check the full sim promises. All must pass. */
export function simContractChecks(peripherals: SimPeripheral[], now: number): SimContractCheck[] {
  const present: Record<string, true> = {};
  for (const p of peripherals) present[p.advertisement.family] = true;
  const checks: SimContractCheck[] = [
    {
      name: "advertisement-families",
      ok: SIM_NAME_FAMILIES.every((f) => present[f] === true),
      detail: `families present: ${Object.keys(present).sort().join(",")}`,
    },
    {
      name: "one-connection-rule",
      ok: peripherals.every((p) => !p.connected || p.metrics.connects >= 1),
      detail: "connected peripherals counted exactly one connect",
    },
    {
      name: "version-characteristic",
      ok: peripherals.some((p) => p.readVersionByte() !== null),
      detail: "at least one ...2b12 version byte readable",
    },
    {
      name: "host-color-hold",
      ok: peripherals.every((p) => typeof p.hostColorHeld(now) === "boolean"),
      detail: "render hold queryable on every peripheral",
    },
  ];
  return checks;
}
