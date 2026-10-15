// T-BLE-09: BLE simulator (full sim behind the backend adapter seam).
//
// Extends the T-BLE-01 to T-BLE-04 peripheral into the full sim the WP04
// contract demands: GATT (version byte on ...2b12), acks on notify, reads,
// masked writes, budget stall behaviour, both encoded-link handshakes (seed
// E7 01 / E7 02, v2 E7 11 01 with a SKU plus MAC reply check), advertisement
// families, the one-connection rule, host colour hold, and the provisioning
// transfer surface. Every BLE probe in CI runs against this sim.
import { describe, expect, it } from "vitest";
import { BLE_VERSION_UUID } from "./constants.js";
import { bleColorMasked, bleHostColorOne, blePower, decodeHostColor } from "./commands.js";
import { encryptedLinkNeed } from "./encrypted.js";
import {
  SimBleAdapter,
  SimPeripheral,
  simContractChecks,
  simFamilyPeripherals,
  simGattState,
  simGoldenFrame,
  simHostColorExpired,
  simProvisionBytes,
  SIM_NAME_FAMILIES,
} from "./sim.js";

describe("ble simulator (T-BLE-09)", () => {
  it("covers every advertisement family with the encoded flag and pact bytes", async () => {
    const peripherals = simFamilyPeripherals();
    expect(peripherals).toHaveLength(SIM_NAME_FAMILIES.length);
    const adapter = new SimBleAdapter({ kind: "noble" });

    for (const p of peripherals) adapter.add(p);
    const found = await adapter.scan(10);
    expect(found.map((f) => f.family).sort()).toEqual([...SIM_NAME_FAMILIES].sort());
    const gv = found.find((f) => f.family === "gv");
    expect(gv?.encoded).toBe(true);
    expect(gv?.pactType).toBe(4);
    expect(gv?.pactCode).toBe(7);
    const gbk = found.find((f) => f.family === "gbk");
    expect(gbk?.encoded).toBe(false);
    expect(encryptedLinkNeed(gv?.manufacturer ?? new Uint8Array(0), 2, "auto").handshakeRequired).toBe(true);
  });

  it("acks writes on notify and applies masked writes by LSB-first mask", async () => {
    const adapter = new SimBleAdapter({ kind: "toolkit-ble" });
    const peripheral = new SimPeripheral({ address: "AA:BB:CC:DD:EE:91", zones: 8, budgetHz: null });
    adapter.add(peripheral);
    const connection = await adapter.connect("AA:BB:CC:DD:EE:91");
    const acks: number[][] = [];
    connection.subscribe((notify) => {
      acks.push([...notify]);
    });
    await connection.write(blePower(true));
    await connection.write(bleColorMasked({ r: 1, g: 2, b: 3 }, [0, 7], 8));
    expect(peripheral.power).toBe(true);
    expect(peripheral.painted[0]).toEqual([1, 2, 3]);
    expect(peripheral.painted[7]).toEqual([1, 2, 3]);
    expect(peripheral.painted[1]).toEqual([0, 0, 0]);
    expect(acks).toEqual([
      [0x33, 0x01, 0x00],
      [0x33, 0x05, 0x00],
    ]);
    expect(peripheral.readState(0x01)).toEqual([1]);
    expect(peripheral.readState(0x0f)).toEqual([8]);
    await connection.disconnect();
  });

  it("stalls past the budget and enforces one connection at a time", async () => {
    // A movable clock: the stall must come from budget exhaustion inside the
    // 1000 ms window and recover once the stall window elapses, not from two
    // writes sharing one frozen timestamp (batch-54).
    let now = 1000;
    const adapter = new SimBleAdapter({ kind: "noble", clock: () => now });
    const peripheral = new SimPeripheral({ address: "AA:BB:CC:DD:EE:92", zones: 4, budgetHz: 10 });
    adapter.add(peripheral);
    const connection = await adapter.connect("AA:BB:CC:DD:EE:92");

    await connection.write(blePower(true));
    expect(peripheral.power).toBe(true);
    // 50 ms later: inside the 100 ms budget spacing -> stalled, not applied.
    now += 50;
    await connection.write(blePower(false));
    expect(peripheral.metrics.stalled).toBe(1);
    expect(peripheral.power).toBe(true);

    // Inside the 2 s stall window every write counts stalled and is dropped.
    now += 100;
    await connection.write(blePower(false));
    expect(peripheral.metrics.stalled).toBe(2);
    expect(peripheral.power).toBe(true);

    // Past stalledUntil (1050 + 2000) writes land again, and the 1000 ms
    // window has evicted the old timestamps so no spacing stall recurs.
    now += 2000;
    await connection.write(blePower(false));
    expect(peripheral.power).toBe(false);
    expect(peripheral.metrics.stalled).toBe(2);

    await expect(adapter.connect("AA:BB:CC:DD:EE:92")).rejects.toThrow(/one connection/);
    await connection.disconnect();
    const retry = await adapter.connect("AA:BB:CC:DD:EE:92");
    await retry.disconnect();
    expect(peripheral.metrics.connects).toBe(2);
  });

  it("exposes GATT state: version byte on ...2b12 plus handshake completion", () => {
    const plain = new SimPeripheral({ address: "AA:BB:CC:DD:EE:93", zones: 2, versionByte: 1 });
    const gatt = simGattState(plain);
    expect(gatt.versionUuid).toBe(BLE_VERSION_UUID);
    expect(gatt.versionByte).toBe(1);
    expect(gatt.handshakeDone).toBe(false);
    const missing = new SimPeripheral({ address: "AA:BB:CC:DD:EE:94", zones: 2 });
    expect(simGattState(missing).versionByte).toBeNull();
  });

  it("holds host colour only for render_hold_ms, then reports expired", () => {
    const peripheral = new SimPeripheral({ address: "AA:BB:CC:DD:EE:95", zones: 2, budgetHz: null, renderHoldMs: 2000 });
    const frame = bleHostColorOne({ r: 9, g: 9, b: 9 });
    expect(decodeHostColor(frame)).not.toBeNull();
    // Channel order end to end: equal components cannot prove rgb order, so
    // a distinct-valued frame is decoded through the peripheral (batch-54).
    const varied = new SimPeripheral({ address: "AA:BB:CC:DD:EE:97", zones: 2, budgetHz: null });
    varied.handleWrite(bleHostColorOne({ r: 1, g: 2, b: 3 }), 7000);
    expect(varied.painted[0]).toEqual([1, 2, 3]);
    peripheral.handleWrite(frame, 7000);
    expect(peripheral.painted[0]).toEqual([9, 9, 9]);
    expect(peripheral.hostColorHeld(7000)).toBe(true);
    // Exact boundary: 7000 + renderHoldMs is already expired (strict <).
    expect(peripheral.hostColorHeld(8999)).toBe(true);
    expect(peripheral.hostColorHeld(9000)).toBe(false);
    expect(peripheral.hostColorHeld(9001)).toBe(false);
    expect(simHostColorExpired(peripheral, 9000)).toBe(true);
  });

  it("records the provisioning transfer bytes in arrival order", () => {
    const peripheral = new SimPeripheral({ address: "AA:BB:CC:DD:EE:96", zones: 2, budgetHz: null });
    expect(peripheral.provisionComplete).toBe(false);
    peripheral.handleWrite(new Uint8Array(Buffer.from(simGoldenFrame(0x33, 0x17, [0x01]), "hex")), 1000);
    const first = new Uint8Array([1, 2, 3]);
    const second = new Uint8Array([4, 5]);
    peripheral.handleWrite(new Uint8Array(Buffer.from(simGoldenFrame(0xa1, 0x11, [...first]), "hex")), 2000);
    peripheral.handleWrite(new Uint8Array(Buffer.from(simGoldenFrame(0xa1, 0x11, [...second]), "hex")), 3000);
    peripheral.handleWrite(new Uint8Array(Buffer.from(simGoldenFrame(0x33, 0x17, [0x00]), "hex")), 4000);
    const received = [...simProvisionBytes(peripheral)];
    // Full padded structure, not magic offsets: each 17-byte chunk keeps the
    // payload then its trailing zeros, so padding corruption and reordering
    // both fail here (batch-54).
    const chunkBytes = peripheral.provisioned[0]?.length ?? 0;

    expect(chunkBytes).toBe(17);
    expect(received).toEqual([
      1, 2, 3, ...Array.from({ length: chunkBytes - 3 }, () => 0),
      4, 5, ...Array.from({ length: chunkBytes - 2 }, () => 0),
    ]);
    expect(peripheral.provisioned).toHaveLength(2);
    expect(peripheral.provisionComplete).toBe(true);
  });

  it("passes every contract check on the family sweep", () => {
    const peripherals = simFamilyPeripherals();
    const checks = simContractChecks(peripherals, 999);
    expect(checks.map((c) => c.name)).toEqual([
      "advertisement-families",
      "one-connection-rule",
      "version-characteristic",
      "host-color-hold",
    ]);
    expect(checks.every((c) => c.ok)).toBe(true);
  });
});
