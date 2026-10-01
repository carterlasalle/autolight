// T-BLE-01 to T-BLE-04 end to end on the sim: selectable by the DS-04
// decision switch, scan, bind, pace, command, stream.
import { describe, expect, it } from "vitest";
import { createBackendSelector } from "./backends.js";
import { bindBleToLan, parseBleAdvertisement } from "./scan.js";
import { BleLink, type BleClock } from "./link.js";
import { bleColorSingle, blePower, bleRead, decodeBleFrame, parseBleAck } from "./commands.js";
import { encodeBleStreamFrame } from "./stream.js";
import { SimBleAdapter, SimPeripheral } from "./sim.js";

class FakeClock implements BleClock {
  current = 200000;
  private tasks = new Map<number, { at: number; fn: () => void }>();
  private next = 1;
  now(): number { return this.current; }
  setTimeout(fn: () => void, ms: number): number {
    const handle = this.next++;
    this.tasks.set(handle, { at: this.current + Math.max(0, ms), fn });
    return handle;
  }
  clearTimeout(handle: number): void { this.tasks.delete(handle); }
  advance(ms: number): void {
    const target = this.current + ms;
    for (;;) {
      let earliest: [number, { at: number; fn: () => void }] | null = null;
      for (const entry of this.tasks) {
        if (entry[1].at <= target && (earliest === null || entry[1].at < earliest[1].at)) earliest = entry;
      }
      if (earliest === null) break;
      this.tasks.delete(earliest[0]);
      this.current = Math.max(this.current, earliest[1].at);
      earliest[1].fn();
    }
    this.current = Math.max(this.current, target);
  }
}

describe("ble end to end on the sim", () => {
  it("selects the backend, scans, binds, paces and streams a two-colour chase", async () => {
    const clock = new FakeClock();
    const toolkitSim = new SimBleAdapter({ kind: "toolkit-ble", clock: () => clock.now() });
    const nobleSim = new SimBleAdapter({ kind: "noble", clock: () => clock.now() });
    const peripheral = new SimPeripheral({
      address: "AA:BB:CC:DD:EE:11",
      name: "GBK_H6076_AB12",
      manufacturer: new Uint8Array([0x00, 4, 7]),
      zones: 8,
      wifiMac: "aa:bb:cc:dd:ee:ff",
      segmentCount: 8,
      budgetHz: null,
    });
    nobleSim.add(peripheral);
    const selector = await createBackendSelector({ mode: "auto", toolkit: toolkitSim, noble: nobleSim });
    expect(selector.currentKind()).toBe("toolkit-ble");

    const found = await nobleSim.scan(10);
    expect(found).toHaveLength(1);
    expect(found[0]?.family).toBe("gbk");
    expect(found[0]?.encoded).toBe(false);
    expect(found[0]?.pactType).toBe(4);

    const binding = bindBleToLan({
      bleAddress: found[0]?.address ?? "",
      lanDeviceId: "lan-h6076",
      bleWifiMac: peripheral.wifiMac,
      lanWifiMac: "AA:BB:CC:DD:EE:FF",
      identifyConfirmed: false,
    });
    expect(binding.basis).toBe("wifi-mac-match");

    const link = new BleLink(binding.bleAddress, nobleSim, { writeBudgetHz: 20, writeDrainMs: 0 }, clock);
    await link.open(() => undefined);
    // One connection at a time: a second connect to the held address fails.
    const second = await nobleSim.connect(binding.bleAddress).catch(() => null);
    expect(second).toBeNull();

    const red: [number, number, number] = [255, 0, 0];
    const blue: [number, number, number] = [0, 0, 255];
    clock.advance(50);
    for (let frame = 0; frame < 40; frame++) {
      const bytes = new Uint8Array(8 * 3);
      for (let z = 0; z < 8; z++) {
        const on = (z + frame) % 2 === 0;
        const color = on ? red : blue;
        bytes[z * 3] = color[0];
        bytes[z * 3 + 1] = color[1];
        bytes[z * 3 + 2] = color[2];
      }
      const writes = encodeBleStreamFrame(bytes, { zoneCount: 8, budgetHz: 20 });
      expect(writes.length).toBe(2);
      for (const write of writes) {
        link.send(write);
        clock.advance(50);
        link.tick();
      }
      await Promise.resolve();
    }
    expect(peripheral.metrics.stalled).toBe(0);
    expect(link.status().writesSent).toBe(80);
    const power = blePower(true);
    expect(decodeBleFrame(power)?.cmd).toBe(0x01);
    const single = bleColorSingle({ r: 9, g: 8, b: 7 });
    expect(decodeBleFrame(single)?.cmd).toBe(0x05);
    expect(decodeBleFrame(bleRead(0x14))?.cmd).toBe(0x14);
    const ack = parseBleAck(new Uint8Array([0x33, 0x05, 0x00]));
    expect(ack?.accepted).toBe(true);
    await link.close();
    expect(link.status().state).toBe("closed");
    expect(parseBleAdvertisement({ address: "X", name: "GVH1A45ZZ", manufacturer: new Uint8Array([0x40]) }).encoded).toBe(true);
  });
});
