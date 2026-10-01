// T-BLE-03: link manager and pacing. One link per device, reconnect with
// backoff, advertising gap tolerance, write pacing against the unit's
// measured budget, drain hold before intentional disconnect, newest-wins,
// and a burst guard that never exceeds the budget under catch-up.
import { describe, expect, it } from "vitest";
import { BLE_DEFAULTS } from "./constants.js";
import { BleLink, type BleClock } from "./link.js";
import { SimBleAdapter, SimPeripheral } from "./sim.js";

class FakeClock implements BleClock {
  current = 100000;
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

function simWith(clock: FakeClock, budgetHz: number | null, address = "AA:BB:CC:DD:EE:01"): { adapter: SimBleAdapter; peripheral: SimPeripheral } {
  const adapter = new SimBleAdapter({ kind: "noble", clock: () => clock.now() });
  const peripheral = new SimPeripheral({ address, name: "GBK_H6076_AB12", manufacturer: new Uint8Array([0]), budgetHz });
  adapter.add(peripheral);
  return { adapter, peripheral };
}

describe("ble link and pacing (T-BLE-03)", () => {
  it("paces writes at the measured budget: a burst never triggers the stall", async () => {
    const clock = new FakeClock();
    const { adapter, peripheral } = simWith(clock, 10);
    const link = new BleLink("AA:BB:CC:DD:EE:01", adapter, { writeBudgetHz: 10, writeDrainMs: 0 }, clock);
    await link.open(() => undefined);
    clock.advance(100);
    for (let i = 0; i < 30; i++) {
      link.send(new Uint8Array([0x33, 0x01, i & 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
      clock.advance(100);
      link.tick();
    }
    clock.advance(500);
    expect(peripheral.metrics.stalled).toBe(0);
    expect(link.status().writesSent).toBe(30);
    await link.close();
  });

  it("marks the default budget unmeasured until the wizard records one", async () => {
    const clock = new FakeClock();
    const { adapter } = simWith(clock, null);
    const link = new BleLink("AA:BB:CC:DD:EE:01", adapter, { writeBudgetHz: null }, clock);
    expect(link.status().budgetHz).toBe(BLE_DEFAULTS.WRITE_BUDGET_HZ);
    expect(link.status().budgetBadge).toBe("unmeasured");
    await link.open(() => undefined);
    expect(link.status().budgetBadge).toBe("unmeasured");
    await link.close();
  });

  it("newest-state-wins: an unsent write is replaced, never queued behind", async () => {
    const clock = new FakeClock();
    const { adapter, peripheral } = simWith(clock, 1);
    const link = new BleLink("AA:BB:CC:DD:EE:01", adapter, { writeBudgetHz: 1, writeDrainMs: 0 }, clock);
    await link.open(() => undefined);
    link.send(new Uint8Array([0x33, 0x01, 0x01, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
    link.send(new Uint8Array([0x33, 0x01, 0x00, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
    expect(link.status().pendingWrites).toBeLessThanOrEqual(1);
    expect(link.status().writesSuperseded).toBe(1);
    clock.advance(1500);
    link.tick();
    await Promise.resolve();
    expect(peripheral.metrics.writes).toBeLessThanOrEqual(2);
    await link.close();
  });

  it("holds the link for the drain window after the last write", async () => {
    const clock = new FakeClock();
    const { adapter } = simWith(clock, null);
    const link = new BleLink("AA:BB:CC:DD:EE:01", adapter, { writeBudgetHz: 100, writeDrainMs: 300 }, clock);
    await link.open(() => undefined);
    clock.advance(10);
    link.send(new Uint8Array([0x33, 0x01, 0x01, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
    clock.advance(10);
    link.tick();
    expect(link.busy).toBe(true);
    clock.advance(300);
    expect(link.busy).toBe(false);
    await link.close();
    expect(link.status().state).toBe("closed");
  });

  it("reconnects with backoff after the advertising gap", async () => {
    const clock = new FakeClock();
    const { adapter } = simWith(clock, null);
    const link = new BleLink(
      "AA:BB:CC:DD:EE:01",
      adapter,
      { writeBudgetHz: 100, writeDrainMs: 0, advertiseGapMs: 1000, backoffMs: [500] },
      clock,
    );
    await link.open(() => undefined);
    clock.advance(1500);
    link.tick();
    for (let i = 0; i < 10 && link.status().state !== "connected"; i++) {
      clock.advance(600);
      await Promise.resolve();
      await Promise.resolve();
      link.tick();
    }
    expect(link.status().reconnects).toBeGreaterThanOrEqual(1);
    expect(link.status().state).toBe("connected");
    await link.close();
  });
});
