import { describe, expect, it } from "vitest";
import { globalCellOrder, applyOrientation, selectResolution } from "./index.js";
import type { Fixture } from "@autolight/contracts";

const mk = (id: string, xs: number[]): Fixture => ({
  id, adapter: "govee", sku: "H6076", hardwareId: id,
  cells: xs.map((x, i) => ({ index: i, position: { x, y: 0 }, order: i, tags: [] })),
  calibration: null,
});

describe("venue", () => {
  it("orders cells left-to-right across fixtures", () => {
    expect(globalCellOrder([mk("right", [0.9]), mk("left", [0.1])]).map((c) => c.fixtureId)).toEqual(["left", "right"]);
  });
  it("reverses on confirmed reverse orientation", () => {
    const cells = [{ fixtureId: "f", cellIndex: 0 }, { fixtureId: "f", cellIndex: 1 }];
    expect(applyOrientation(cells, "reverse").map((c) => c.cellIndex)).toEqual([1, 0]);
  });
  it("picks highest stable resolution", () => {
    expect(selectResolution([{ zones: 200, stableFps: 10 }, { zones: 40, stableFps: 30 }], 24)).toBe(40);
    expect(selectResolution([{ zones: 200, stableFps: 10 }], 24)).toBeNull();
  });
});
