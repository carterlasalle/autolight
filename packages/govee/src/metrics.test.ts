// T-GOV-19 metrics tests: counters accumulate, gauges replace, an RTT
// stamps the last response, reconnects count, and snapshots are copies the
// Diagnostics screen can read without touching the collector.
import { describe, expect, it } from "vitest";
import { DeviceMetrics } from "./metrics.js";

describe("DeviceMetrics", () => {
  it("accumulates frame counters and replaces gauges", () => {
    const metrics = new DeviceMetrics();
    metrics.record("aa", { framesRequested: 10, framesSent: 8, framesSuperseded: 2, effectiveFps: 30 });
    const row = metrics.record("aa", {
      framesRequested: 5, framesSent: 5, framesSuperseded: 1, effectiveFps: 25,
      transport: "lan", engine: "native-ts", health: "degraded",
    });
    expect(row.framesRequested).toBe(15);
    expect(row.framesSent).toBe(13);
    expect(row.framesSuperseded).toBe(3);
    expect(row.effectiveFps).toBe(25);
    expect(row.health).toBe("degraded");
  });

  it("stamps the last response on an RTT and keeps it on a null RTT", () => {
    let now = 1000;
    const metrics = new DeviceMetrics();
    metrics.record("aa", { statusRttMs: 42, clock: () => now });
    now = 2000;
    const row = metrics.record("aa", { statusRttMs: null, clock: () => now });
    expect(row.statusRttMs).toBeNull();
    expect(row.lastResponseAtMs).toBe(1000);
  });

  it("counts reconnects, marks offline, and hands out copies", () => {
    const metrics = new DeviceMetrics();
    metrics.record("aa", { framesSent: 1 });
    metrics.record("bb", { framesSent: 2 });
    expect(metrics.recordReconnect("aa")).toBe(1);
    expect(metrics.recordReconnect("aa")).toBe(2);
    metrics.markOffline("bb");
    const again = metrics.snapshot("aa");
    expect(again?.reconnects).toBe(2);
    expect(metrics.snapshot("bb")?.health).toBe("offline");
    expect(metrics.snapshot("missing")).toBeNull();
    if (again) again.framesSent = 999;
    expect(metrics.snapshot("aa")?.framesSent).toBe(1);
    expect(metrics.snapshotAll().map((row) => row.hardwareId).sort()).toEqual(["aa", "bb"]);
  });
});
