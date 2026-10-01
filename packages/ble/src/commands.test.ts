// T-BLE-04: command set and dialects. Golden vectors computed by the
// independent sim encoder (never by the production codec), ack parsing,
// read-back states, masked masks, per-zone brightness, interpolation, host
// colour, segment stream planning and provisioning frames.
import { describe, expect, it } from "vitest";
import { BLE_PROTYPE } from "./constants.js";
import {
  bleBrightness,
  bleColorMasked,
  bleColorSingle,
  bleHex,
  bleHostColorOne,
  bleHostColorProbe,
  bleInterpolation,
  bleMaskedBrightness,
  blePerZoneBrightness,
  blePower,
  bleRead,
  decodeBleFrame,
  decodeHostColor,
  defaultBleDialect,
  encodeBleFrame,
  encodeHostColor,
  maskForZones,
  parseBleAck,
} from "./commands.js";
import { encryptedLinkNeed } from "./encrypted.js";
import { bleProvisionChunk, bleProvisionChunks, bleProvisionStart, bleProvisionStop } from "./provisioning.js";
import { bleBlackoutFrame, encodeBleStreamFrame, planBleFrame } from "./stream.js";
import { SimBleAdapter, SimPeripheral, simGoldenFrame } from "./sim.js";

function frameBytes(hex: string): Uint8Array {
  return new Uint8Array(Buffer.from(hex, "hex"));
}

describe("ble commands (T-BLE-04)", () => {
  it("encodes 20 byte frames with the XOR checksum", () => {
    expect(bleHex(blePower(true))).toBe(simGoldenFrame(BLE_PROTYPE.WRITE, 0x01, [0x01]));
    expect(bleHex(blePower(false))).toBe(simGoldenFrame(BLE_PROTYPE.WRITE, 0x01, [0x00]));
    const frame = blePower(true);
    expect(frame.length).toBe(20);
    const decoded = decodeBleFrame(frame);
    expect(decoded?.proType).toBe(BLE_PROTYPE.WRITE);
    expect(decoded?.payload[0]).toBe(0x01);
  });

  it("rejects bad checksums and bad lengths", () => {
    const bad = frameBytes(bleHex(blePower(true)));
    bad[19]! ^= 0xff;
    expect(decodeBleFrame(bad)).toBeNull();
    expect(decodeBleFrame(new Uint8Array([0x33, 0x01]))).toBeNull();
    expect(() => encodeBleFrame(BLE_PROTYPE.WRITE, 0x01, new Uint8Array(18))).toThrow(/at most 17/);
  });

  it("scales brightness per family (1 to 100 or 0 to 255)", () => {
    expect(bleHex(bleBrightness(1, 100))).toBe(simGoldenFrame(BLE_PROTYPE.WRITE, 0x04, [100]));
    expect(bleHex(bleBrightness(1, 255))).toBe(simGoldenFrame(BLE_PROTYPE.WRITE, 0x04, [255]));
    expect(bleHex(bleBrightness(0, 100))).toBe(simGoldenFrame(BLE_PROTYPE.WRITE, 0x04, [0]));
    expect(bleHex(bleBrightness(0.5, 100))).toBe(simGoldenFrame(BLE_PROTYPE.WRITE, 0x04, [50]));
  });

  it("encodes single, masked and legacy colours", () => {
    const single = bleColorSingle({ r: 255, g: 0, b: 0 });
    expect(bleHex(single)).toBe(simGoldenFrame(BLE_PROTYPE.WRITE, 0x05, [0x0d, 255, 0, 0, 0, 0, 0, 0, 0]));
    const masked = bleColorMasked({ r: 0, g: 255, b: 0 }, [0, 2], 8);
    expect(bleHex(masked)).toBe(simGoldenFrame(BLE_PROTYPE.WRITE, 0x05, [0x15, 0x01, 0, 255, 0, 0, 0, 0, 0, 0b00000101]));
    expect(maskForZones([0, 7], 8)).toEqual(new Uint8Array([0b10000001]));
    expect(() => maskForZones([8], 8)).toThrow(/outside/);
  });

  it("encodes masked and per-zone brightness plus interpolation", () => {
    expect(bleHex(bleMaskedBrightness(1, [1], 8, 100))).toBe(
      simGoldenFrame(BLE_PROTYPE.WRITE, 0x05, [0x15, 0x02, 100, 0b00000010]),
    );
    expect(bleHex(blePerZoneBrightness([0, 0.5, 1], 100))).toBe(
      simGoldenFrame(BLE_PROTYPE.WRITE, 0x05, [0x15, 0x03, 0, 50, 100]),
    );
    expect(bleHex(bleInterpolation(true))).toBe(simGoldenFrame(BLE_PROTYPE.WRITE, 0xa3, [0x01]));
    expect(bleHex(bleInterpolation(false))).toBe(simGoldenFrame(BLE_PROTYPE.WRITE, 0xa3, [0x00]));
  });

  it("encodes every read in the WP04 list", () => {
    expect(bleHex(bleRead(0x01))).toBe(simGoldenFrame(BLE_PROTYPE.READ, 0x01, []));
    expect(bleHex(bleRead(0x04))).toBe(simGoldenFrame(BLE_PROTYPE.READ, 0x04, []));
    expect(bleHex(bleRead(0x05))).toBe(simGoldenFrame(BLE_PROTYPE.READ, 0x05, []));
    expect(bleHex(bleRead(0x06))).toBe(simGoldenFrame(BLE_PROTYPE.READ, 0x06, []));
    expect(bleHex(bleRead(0x07, new Uint8Array([0x03])))).toBe(simGoldenFrame(BLE_PROTYPE.READ, 0x07, [0x03]));
    expect(bleHex(bleRead(0x0f))).toBe(simGoldenFrame(BLE_PROTYPE.READ, 0x0f, []));
    expect(bleHex(bleRead(0x14))).toBe(simGoldenFrame(BLE_PROTYPE.READ, 0x14, []));
    expect(bleHex(bleRead(0x20))).toBe(simGoldenFrame(BLE_PROTYPE.READ, 0x20, []));
    expect(bleHex(bleRead(0x21))).toBe(simGoldenFrame(BLE_PROTYPE.READ, 0x21, []));
    expect(bleHex(bleRead(0x40))).toBe(simGoldenFrame(BLE_PROTYPE.READ, 0x40, []));
    expect(bleHex(bleRead(0xab))).toBe(simGoldenFrame(BLE_PROTYPE.READ, 0xab, []));
    expect(bleHex(bleRead(0xa5, new Uint8Array([0x02])))).toBe(simGoldenFrame(BLE_PROTYPE.READ, 0xa5, [0x02]));
  });

  it("parses acks: 00 means accepted, not applied", () => {
    expect(parseBleAck(new Uint8Array([0x33, 0x01, 0x00]))).toEqual({ cmd: 0x01, status: 0x00, accepted: true });
    expect(parseBleAck(new Uint8Array([0x33, 0x05, 0x01]))?.accepted).toBe(false);
    expect(parseBleAck(new Uint8Array([0xaa, 0x01, 0x00]))).toBeNull();
    expect(parseBleAck(new Uint8Array([0x33]))).toBeNull();
  });

  it("encodes short host colour frames with a sum checksum", () => {
    const probe = bleHostColorProbe();
    expect([...probe]).toEqual([0xa5, 0x02, 0x90, (0xa5 + 0x02 + 0x90) & 0xff]);
    const one = bleHostColorOne({ r: 10, g: 20, b: 30 });
    expect(decodeHostColor(one)).toEqual({ sub: 0x02, payload: new Uint8Array([0x83, 10, 20, 30]) });
    const broken = one.slice();
    broken[broken.length - 1]! ^= 0x01;
    expect(decodeHostColor(broken)).toBeNull();
    expect(() => encodeBleFrame(BLE_PROTYPE.HOST_COLOR, 0x02)).toThrow(/encodeHostColor/);
    expect(encodeHostColor(0x02, new Uint8Array([0x90]))).toEqual(probe);
  });

  it("records the dialect per device, never assumed", () => {
    const dialect = defaultBleDialect();
    expect(dialect.brightnessScale).toBe(100);
    expect(dialect.colorModes).toEqual(["single-0d"]);
    expect({ ...dialect, brightnessScale: 255 as const }.brightnessScale).toBe(255);
  });

  it("plans masked writes largest group first and reports the effective rate", () => {
    const frame = new Uint8Array([255, 0, 0, 255, 0, 0, 0, 0, 255, 0, 0, 255]);
    const plan = planBleFrame(frame, 4, 100);
    expect(plan.distinctColours).toBe(2);
    expect(plan.writes[0]?.zones).toEqual([0, 1]);
    expect(plan.effectiveFps).toBe(50);
    expect(plan.singleColour).toBe(false);
    expect(() => planBleFrame(new Uint8Array([1]), 4, 100)).toThrow(/needs .* bytes/);
  });

  it("takes the single-colour fast path, masked blackout, host colour when qualified", () => {
    const solid = new Uint8Array([10, 20, 30, 10, 20, 30, 10, 20, 30]);
    expect(encodeBleStreamFrame(solid, { zoneCount: 3, budgetHz: 100 })).toHaveLength(1);
    expect(encodeBleStreamFrame(solid, { zoneCount: 3, budgetHz: 100, hostColorQualified: true })[0]?.[0]).toBe(0xa5);
    const mixed = new Uint8Array([255, 0, 0, 0, 255, 0, 255, 0, 0]);
    expect(encodeBleStreamFrame(mixed, { zoneCount: 3, budgetHz: 100 })).toHaveLength(2);
    expect(bleBlackoutFrame(3)).toEqual(new Uint8Array(9));
    const blackout = encodeBleStreamFrame(bleBlackoutFrame(2), { zoneCount: 2, budgetHz: 50 });
    expect(blackout).toHaveLength(1);
    expect(blackout[0]?.[0]).toBe(0x33);
  });

  it("flags the encoded link without owning keys", () => {
    expect(encryptedLinkNeed(new Uint8Array([0x40]), null, "auto").handshakeRequired).toBe(true);
    expect(encryptedLinkNeed(new Uint8Array([0x00]), 2, "auto").handshakeRequired).toBe(true);
    expect(encryptedLinkNeed(new Uint8Array([0x00]), null, "auto").handshakeRequired).toBe(false);
    expect(encryptedLinkNeed(new Uint8Array([0x40]), null, "off").handshakeRequired).toBe(false);
    expect(encryptedLinkNeed(new Uint8Array([0x00]), null, "on").handshakeRequired).toBe(true);
  });

  it("builds provisioning frames with the worked start, chunks and stop", () => {
    expect(bleHex(bleProvisionStart())).toBe(simGoldenFrame(BLE_PROTYPE.WRITE, 0x17, [0x01]));
    expect(bleHex(bleProvisionStop())).toBe(simGoldenFrame(BLE_PROTYPE.WRITE, 0x17, [0x00]));
    expect(bleHex(bleProvisionChunk(new Uint8Array([1, 2, 3])))).toBe(simGoldenFrame(0xa1, 0x11, [1, 2, 3]));
    const chunks = bleProvisionChunks(new Uint8Array(40).fill(7));
    expect(chunks.map((c) => c.length)).toEqual([17, 17, 6]);
    expect(() => bleProvisionChunks(new Uint8Array([1]), 18)).toThrow(/1 to 17/);
  });

  it("round trips through the sim: writes ack, reads report sim state", async () => {
    const adapter = new SimBleAdapter({ kind: "toolkit-ble", clock: () => Date.now() });
    const peripheral = new SimPeripheral({
      address: "AA:BB:CC:DD:EE:09",
      name: "GBK_H6076_AB12",
      manufacturer: new Uint8Array([0x00, 1, 2]),
      zones: 2,
      wifiMac: "aa:bb:cc:dd:ee:ff",
      segmentCount: 2,
      budgetHz: null,
    });
    adapter.add(peripheral);
    const found = await adapter.scan(10);
    expect(found.map((f) => f.address)).toEqual(["AA:BB:CC:DD:EE:09"]);
    const connection = await adapter.connect("AA:BB:CC:DD:EE:09");
    const acks: number[] = [];
    connection.subscribe((notify) => {
      const ack = parseBleAck(notify);
      if (ack !== null) acks.push(ack.status);
    });
    await connection.write(blePower(true));
    expect(peripheral.power).toBe(true);
    await connection.write(bleColorSingle({ r: 1, g: 2, b: 3 }));
    expect(peripheral.painted[0]).toEqual([1, 2, 3]);
    expect(peripheral.readState(0x01)).toEqual([1]);
    expect(peripheral.readState(0x14)).toBe("aa:bb:cc:dd:ee:ff");
    expect(acks).toEqual([0, 0]);
    await connection.disconnect();
    await adapter.close();
  });
});
