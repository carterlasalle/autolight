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
    const frame = (i: number): Uint8Array => new Uint8Array([0x33, 0x01, i & 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

    // Burst: 30 frames arrive inside one budget window. Newest-wins keeps a
    // single queued frame and the pacer releases it on the next due slot, so
    // catch-up can never exceed the unit's budget.
    for (let i = 0; i < 30; i++) link.send(frame(i));
    expect(link.status().writesSuperseded).toBe(29);
    clock.advance(100);
    link.tick();

    // Sustained cadence at the budget: every frame lands, none stalls.
    for (let i = 0; i < 30; i++) {
      link.send(frame(i));
      clock.advance(100);
      link.tick();
    }

    clock.advance(500);
    expect(peripheral.metrics.stalled).toBe(0);
    expect(link.status().writesSent).toBe(31);
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
    // The wizard records a budget by persisting it into the link config: the
    // next link carries the measured value and loses the badge.
    const measured = new BleLink("AA:BB:CC:DD:EE:01", adapter, { writeBudgetHz: 10 }, clock);

    expect(measured.status().budgetHz).toBe(10);
    expect(measured.status().budgetBadge).toBeNull();
  });

  it("newest-state-wins: an unsent write is replaced, never queued behind", async () => {
    const clock = new FakeClock();
    const { adapter, peripheral } = simWith(clock, 1);
    const link = new BleLink("AA:BB:CC:DD:EE:01", adapter, { writeBudgetHz: 1, writeDrainMs: 0 }, clock);
    await link.open(() => undefined);
    link.send(new Uint8Array([0x33, 0x01, 0x01, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
    link.send(new Uint8Array([0x33, 0x01, 0x00, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
    expect(link.status().pendingWrites).toBe(1);
    expect(link.status().writesSuperseded).toBe(1);
    clock.advance(1500);
    link.tick();
    await Promise.resolve();
    expect(peripheral.metrics.writes).toBe(1);
    expect(peripheral.written).toHaveLength(1);
    // The frame that landed is the newest one (payload byte 2 === 0x00), not
    // the superseded one.
    expect(peripheral.written[0]?.[2]).toBe(0);
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

    // Close inside the drain window: close() must hold the link until the
    // window elapses instead of cutting it short of the last write's ack.
    let settled = false;
    const closed = link.close().then(() => {
      settled = true;
    });

    clock.advance(280);
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(link.status().state).not.toBe("closed");
    clock.advance(20);
    await closed;
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

    // Exactly one reconnect started: the gap triggered a single attempt and
    // its backoff succeeded (a broken backoff that never waited would still
    // pass >= 1 here, an exact count pins the flow).
    expect(link.status().reconnects).toBe(1);
    expect(link.status().state).toBe("connected");
    await link.close();
  });
});
