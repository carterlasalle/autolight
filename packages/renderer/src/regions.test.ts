import { describe, expect, it } from "vitest";
import type { Fixture } from "@autolight/contracts";
import type { VenueFields } from "@autolight/venue";
import { SelectorCache, cellIdToIndex, denseFrame, frameByCellId, physicalRegions, writeDense } from "./regions.js";
import { capabilityForFixture, plannerAvoidsDegraded, simplifyColors, singleZoneColor } from "./capability.js";

const mk = (id: string, cells: number): Fixture => ({
  id, adapter: "govee", sku: "SIM", hardwareId: id,
  cells: Array.from({ length: cells }, (_, i) => ({ index: i, position: { x: i, y: 0 }, order: i, tags: [] })),
  calibration: null,
});

describe("T-REND-05 physical regions, dense arrays, correct addressing", () => {
  it("addresses dense frames by physical index through the logical table", () => {
    const fixtures = [mk("a", 4), mk("b", 2)];
    expect(physicalRegions(fixtures)).toEqual([
      { fixtureId: "a", startIndex: 0, length: 4 },
      { fixtureId: "b", startIndex: 0, length: 2 },
    ]);
    const frames = denseFrame(fixtures);
    const logical = new Uint8Array([10, 11, 12, 20, 21, 22, 30, 31, 32]);
    writeDense(frames, "a", logical, new Uint32Array([2, 1, 0]));
    expect([...frames.get("a")!]).toEqual([30, 31, 32, 20, 21, 22, 10, 11, 12, 0, 0, 0]);
    expect(frameByCellId(frames, "a:0")).toEqual([30, 31, 32]);
    expect(frameByCellId(frames, "b:9")).toBeNull();
  });

  it("caches selector resolution per venue version", () => {
    const cache = new SelectorCache();
    let calls = 0;
    const first = cache.resolve(1, "LEFT", () => { calls++; return ["a:0"]; });
    const second = cache.resolve(1, "LEFT", () => { calls++; return ["a:0"]; });
    expect(second).toBe(first);
    expect(calls).toBe(1);
    cache.resolve(2, "LEFT", () => { calls++; return ["a:1"]; });
    expect(calls).toBe(2);
  });

  it("resolves UI reads by cell id, never by array position", () => {
    const stub = { keys: ["strip:0", "strip:1", "lamp:0"] } as unknown as VenueFields;
    expect(cellIdToIndex(stub, "strip:1")).toBe(1);
    expect(cellIdToIndex(stub, "strip:999")).toBe(-1);
  });
});

describe("T-FOV-03 capability-aware rendering", () => {
  it("degrades single-zone and BLE budgets with representative colours", () => {
    const f = mk("ble", 4);
    expect(capabilityForFixture(f, "lan-segmented").degraded).toBe(false);
    const ble = capabilityForFixture(f, "ble-segmented");
    expect(ble.degraded).toBe(true);
    expect(ble.maxDistinctColoursPerFrame).toBe(6);
    expect(singleZoneColor([[255, 0, 0], [0, 0, 255]], "mean-linear")).toEqual([127.5, 0, 127.5]);
    expect(singleZoneColor([[255, 0, 0], [0, 0, 255]], "center-cell")).toEqual([0, 0, 255]);
    const many: [number, number, number][] = Array.from({ length: 10 }, (_, i) => [i * 25, 0, 0]);
    expect(new Set(simplifyColors(many, 2).map((c) => c.join(","))).size).toBeLessThanOrEqual(2);
    expect(plannerAvoidsDegraded(["a", "b"], ["b"])).toEqual(["a"]);
  });
});
