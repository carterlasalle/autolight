import { describe, expect, it } from "vitest";
import { globalCellOrder, applyOrientation, selectResolution, resolveTarget, emptyQualification, qualificationComplete } from "./index.js";
import type { Fixture } from "@autolight/contracts";

const mk = (id: string, xs: number[]): Fixture => ({
  id, adapter: "govee", sku: "H6076", hardwareId: id,
  cells: xs.map((x, i) => ({ index: i, position: { x, y: 0 }, order: i, tags: [] })),
  calibration: null,
});

describe("venue", () => {
  it("orders cells left-to-right across fixtures", () => {
    // Ids sort opposite to positions, so an id-sorted implementation fails.
    expect(globalCellOrder([mk("aaa", [0.9]), mk("zzz", [0.1])]).map((c) => c.fixtureId)).toEqual(["zzz", "aaa"]);
    // Intra-fixture order is by x then y: equal x falls back to y ascending.
    const cross: Fixture = {
      id: "cross", adapter: "govee", sku: "H6076", hardwareId: "cross",
      cells: [
        { index: 0, position: { x: 0.5, y: 1 }, order: 0, tags: [] },
        { index: 1, position: { x: 0.4, y: 0 }, order: 1, tags: [] },
        { index: 2, position: { x: 0.5, y: 0 }, order: 2, tags: [] },
      ],
      calibration: null,
    };

    expect(globalCellOrder([cross]).map((c) => c.cellIndex)).toEqual([1, 2, 0]);
  });
  it("reverses on confirmed reverse orientation", () => {
    const cells = [{ fixtureId: "f", cellIndex: 0 }, { fixtureId: "f", cellIndex: 1 }];
    expect(applyOrientation(cells, "reverse").map((c) => c.cellIndex)).toEqual([1, 0]);
    // Forward is the identity and neither branch mutates the input.
    expect(applyOrientation(cells, "forward")).toEqual(cells);
    expect(cells.map((c) => c.cellIndex)).toEqual([0, 1]);
  });
  it("picks highest stable resolution", () => {
    expect(selectResolution([{ zones: 200, stableFps: 10 }, { zones: 40, stableFps: 30 }], 24)).toBe(40);
    expect(selectResolution([{ zones: 200, stableFps: 10 }], 24)).toBeNull();
    // The target itself qualifies (>=), and just under it does not.
    expect(selectResolution([{ zones: 60, stableFps: 24 }], 24)).toBe(60);
    expect(selectResolution([{ zones: 80, stableFps: 23.9 }], 24)).toBeNull();
  });
  it("tracks wizard completion", () => {
    const q = emptyQualification();
    expect(qualificationComplete(q)).toBe(false);

    for (const k of Object.keys(q.passed) as (keyof typeof q.passed)[]) q.passed[k] = true;
    expect(qualificationComplete(q)).toBe(true);
  });
  it("resolves semantic targets", () => {
    // PRIMARY deliberately sits on the right fixture: LEFT (positional) and
    // PRIMARY (group) must resolve differently, so a misrouted mapping fails.
    const left = { ...mk("left", [0.1]), groups: ["SECONDARY"] };
    const right = { ...mk("right", [0.9]), groups: ["PRIMARY"] };
    expect(resolveTarget([left, right], "ALL")).toHaveLength(2);
    expect(resolveTarget([left, right], "LEFT").map((c) => c.fixtureId)).toEqual(["left"]);
    expect(resolveTarget([left, right], "PRIMARY").map((c) => c.fixtureId)).toEqual(["right"]);
    expect(resolveTarget([left, right], "NOPE")).toEqual([]);
  });
});
