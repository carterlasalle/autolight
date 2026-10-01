// T-BLE-05: BLE segment stream (renderer feed over the planning seam).
//
// stream.ts already plans masked writes; this test proves the renderer feed:
// one renderer frame (zoneCount RGB triples, as renderFrame produces for one
// fixture) encodes to link writes and reports the fixture's current effective
// capability (distinct colours, budget / distinctColours, single-colour flag)
// so the planner and mixer simplify patterns on BLE fixtures. Single-colour
// takes the fast path (host colour when qualified), blackout stays a masked
// write of black (never power off), and the two-colour chase at 20 fps holds
// pacing with zero sim stalls.
import { describe, expect, it } from "vitest";
import { decodeBleFrame, decodeHostColor } from "./commands.js";
import { BleLink, type BleClock } from "./link.js";
import { SimBleAdapter, SimPeripheral } from "./sim.js";
import {
  bleBlackoutFrame,
  encodeBleStreamFrame,
  planBleFrame,
  streamBleRendererFrame,
} from "./stream.js";

class FakeClock implements BleClock {
  current = 300000;
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

function twoColorFrame(zones: number, flip: boolean): Uint8Array {
  const out = new Uint8Array(zones * 3);
  for (let z = 0; z < zones; z++) {
    const red = (z % 2 === 0) === flip;
    out[z * 3] = red ? 255 : 0;
    out[z * 3 + 1] = 0;
    out[z * 3 + 2] = red ? 0 : 255;
  }
  return out;
}

describe("ble segment stream (T-BLE-05)", () => {
  it("reports the effective capability: budget divided by distinct colours", () => {
    const plan = planBleFrame(twoColorFrame(8, false), 8, 20);
    expect(plan.distinctColours).toBe(2);
    expect(plan.effectiveFps).toBe(10);
    expect(plan.singleColour).toBe(false);
    expect(plan.writes[0]?.zones).toHaveLength(4);
  });

  it("quantisation merges near colours so the planner can simplify", () => {
    const frame = new Uint8Array([250, 0, 0, 255, 5, 5, 0, 0, 255, 5, 5, 250]);
    expect(planBleFrame(frame, 4, 100).distinctColours).toBe(4);
    const quantized = streamBleRendererFrame(frame, { zoneCount: 4, budgetHz: 100, quantizeLevels: 4 });
    expect(quantized.feedback.quantized).toBe(true);
    expect(quantized.feedback.distinctColours).toBeLessThan(4);
    expect(quantized.writes).toHaveLength(quantized.feedback.distinctColours);
  });

  it("single-colour frames take the fast path, host colour when qualified", () => {
    const solid = new Uint8Array([10, 20, 30, 10, 20, 30, 10, 20, 30]);
    const plain = streamBleRendererFrame(solid, { zoneCount: 3, budgetHz: 100 });
    expect(plain.writes).toHaveLength(1);
    expect(plain.feedback.singleColour).toBe(true);
    expect(plain.feedback.effectiveFps).toBe(100);
    expect(decodeBleFrame(plain.writes[0] ?? new Uint8Array(0))?.cmd).toBe(0x05);
    const host = streamBleRendererFrame(solid, { zoneCount: 3, budgetHz: 100, hostColorQualified: true });
    expect(decodeHostColor(host.writes[0] ?? new Uint8Array(0))?.payload[0]).toBe(0x83);
  });

  it("blackout is a masked write of black, never power off", () => {
    const frame = bleBlackoutFrame(4);
    expect(frame).toEqual(new Uint8Array(12));
    const streamed = streamBleRendererFrame(frame, { zoneCount: 4, budgetHz: 50 });
    expect(streamed.writes).toHaveLength(1);
    const decoded = decodeBleFrame(streamed.writes[0] ?? new Uint8Array(0));
    expect(decoded?.proType).toBe(0x33);
    expect(decoded?.cmd).toBe(0x05);
    expect(decoded?.payload[0]).toBe(0x0d);
  });

  it("streams a two-colour chase at 20 fps through the paced link with zero stalls", async () => {
    const clock = new FakeClock();
    const adapter = new SimBleAdapter({ kind: "noble", clock: () => clock.now() });
    const peripheral = new SimPeripheral({
      address: "AA:BB:CC:DD:EE:51",
      name: "GBK_H6076_51",
      manufacturer: new Uint8Array([0x00, 4, 7]),
      zones: 8,
      budgetHz: null,
    });
    adapter.add(peripheral);
    const link = new BleLink("AA:BB:CC:DD:EE:51", adapter, { writeBudgetHz: 20, writeDrainMs: 0 }, clock);
    await link.open(() => undefined);
    clock.advance(50);
    let lastFeedback = streamBleRendererFrame(twoColorFrame(8, true), { zoneCount: 8, budgetHz: 20 }).feedback;
    for (let frame = 0; frame < 40; frame++) {
      const bytes = twoColorFrame(8, frame % 2 === 0);
      const streamed = streamBleRendererFrame(bytes, { zoneCount: 8, budgetHz: 20 });
      lastFeedback = streamed.feedback;
      expect(encodeBleStreamFrame(bytes, { zoneCount: 8, budgetHz: 20 })).toHaveLength(2);
      for (const write of streamed.writes) {
        link.send(write);
        clock.advance(50);
        link.tick();
      }
      await Promise.resolve();
    }
    expect(lastFeedback.distinctColours).toBe(2);
    expect(lastFeedback.effectiveFps).toBe(10);
    expect(peripheral.metrics.stalled).toBe(0);
    expect(link.status().writesSent).toBe(80);
    await link.close();
  });
});
