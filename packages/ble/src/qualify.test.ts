// T-BLE-06: BLE qualification (per-unit budgets, dialects, wizard records).
//
// Proves the wizard order from WP04: connect, versions, aa 0f segment count,
// aa 40 IC count, masked-write user verification (dialect recorded), budget
// benchmark (rate raised until the sim stalls, then backed off, with burst
// ceiling and recovery), drain, render hold, camera latency. Records land in
// a device_calibrations-shaped row with transport ble; anything unmeasured
// stays named in unmeasured instead of a number.
import { describe, expect, it } from "vitest";
import {
  BLE_WIZARD_STEPS,
  blankBleQualification,
  bleQualificationSimReady,
  runBleQualification,
} from "./qualify.js";
import { SimPeripheral, simContractChecks, simFamilyPeripherals } from "./sim.js";

const scriptedUser = (latency: number | null) => ({
  confirmMaskedWrite: async (_pattern: "masked-stripe"): Promise<boolean> => {
    void _pattern;
    return true;
  },
  readLatencyMs: async (): Promise<number | null> => latency,
});

describe("ble qualification (T-BLE-06)", () => {
  it("starts blank: every measurement named unmeasured, never zero-filled", () => {
    const blank = blankBleQualification("AA:BB:CC:DD:EE:61");
    expect(blank.transport).toBe("ble");
    expect(blank.writeBudgetHz).toBeNull();
    expect(blank.unmeasured).toContain("writeBudgetHz");
    expect(blank.unmeasured).toContain("latencyMs");
  });

  it("runs every wizard step in order and stores a ble device_calibrations row", async () => {
    let now = 500000;
    const peripheral = new SimPeripheral({
      address: "AA:BB:CC:DD:EE:62",
      name: "GBK_H6076_62",
      manufacturer: new Uint8Array([0x00, 4, 7]),
      zones: 8,
      wifiMac: "aa:bb:cc:dd:ee:62",
      segmentCount: 8,
      budgetHz: 20,
      sku: "H6076",
      renderHoldMs: 2000,
    });
    const { record, steps } = await runBleQualification({
      peripheral,
      now: () => now,
      user: scriptedUser(25),
    });
    now += 3000;
    expect(steps.map((s) => s.step)).toEqual([...BLE_WIZARD_STEPS]);
    expect(steps.every((s) => s.ok)).toBe(true);
    expect(record.transport).toBe("ble");
    expect(record.segmentCount).toBe(8);
    expect(record.icCount).toBe(8);
    expect(record.hardVersion).toBe("3.01.01");
    expect(record.maskedWriteVerified).toBe(true);
    expect(record.dialect.colorModes).toContain("masked-15-01");
    expect(record.writeBudgetHz).toBe(20);
    expect(record.burstCeilingHz).toBe(30);
    expect(record.recoveryMs).toBe(2000);
    expect(record.writeDrainMs).toBe(300);
    expect(record.renderHoldMs).toBe(2000);
    expect(record.latencyMs).toBe(25);
    expect(record.encryptedHandshake).toBe("plain");
    expect(record.unmeasured).toEqual([]);
  });

  it("reports v2 versus seed handshakes and keeps unmeasured honest", async () => {
    const v2 = new SimPeripheral({
      address: "AA:BB:CC:DD:EE:63",
      name: "GVH607663AA",
      manufacturer: new Uint8Array([0x40, 4, 7]),
      zones: 8,
      versionByte: 2,
      budgetHz: null,
      sku: "H6076",
    });
    const denied = {
      confirmMaskedWrite: async (): Promise<boolean> => false,
      readLatencyMs: async (): Promise<number | null> => null,
    };
    const { record } = await runBleQualification({ peripheral: v2, now: () => 1, user: denied });
    expect(record.encryptedHandshake).toBe("v2");
    expect(record.maskedWriteVerified).toBe(false);
    expect(record.dialect.colorModes).toEqual(["single-0d"]);
    expect(record.writeBudgetHz).toBeNull();
    expect(record.latencyMs).toBeNull();
    expect(record.unmeasured).toContain("maskedWrite");
    expect(record.unmeasured).toContain("writeBudgetHz");
    expect(record.unmeasured).toContain("renderHoldMs");
    expect(record.unmeasured).toContain("latencyMs");

    const seed = new SimPeripheral({
      address: "AA:BB:CC:DD:EE:64",
      name: "GBK_H6076_64",
      manufacturer: new Uint8Array([0x40, 4, 7]),
      zones: 8,
      versionByte: 1,
      budgetHz: 10,
      sku: "H6076",
    });
    const seeded = await runBleQualification({ peripheral: seed, now: () => 1, user: scriptedUser(null) });
    expect(seeded.record.encryptedHandshake).toBe("seed");
    expect(seeded.record.writeBudgetHz).toBe(10);
  });

  it("gates on the full-sim contract before trusting the wizard", () => {
    const family = simFamilyPeripherals();
    expect(simContractChecks(family, 999).every((c) => c.ok)).toBe(true);
    expect(bleQualificationSimReady(family, 999)).toBe(true);
    const lone = [new SimPeripheral({ address: "AA:BB:CC:DD:EE:65", zones: 8 })];
    expect(bleQualificationSimReady(lone, 999)).toBe(false);
  });
});
