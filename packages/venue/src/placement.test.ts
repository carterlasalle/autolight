import { describe, expect, it } from "vitest";
import { applyLogicalOrder, fitRunMapping, logicalToPhysical, orderLogical, rotateLogicalZero, runLength, topologyForRuns } from "./placement.js";
import type { Run } from "./placement.js";

const square = (z = 2.5): Run => ({
  id: "loop",
  polyline: [
    { x: -2.5, y: -2.5, z },
    { x: -2.5, y: 2.5, z },
    { x: 2.5, y: 2.5, z },
    { x: 2.5, y: -2.5, z },
  ],
  closed: true,
  mirroredOf: null,
});

describe("T-ROOM-02 placements and Fixture v2", () => {
  it("measures the closed loop perimeter", () => {
    expect(runLength(square())).toBeCloseTo(20, 9);
  });

  it("fits anchors monotonically and rejects non-monotonic fits", () => {
    const run = square();

    const cells = fitRunMapping(run, 20, [
      { cell: 0, run: "loop", atMeters: 0 },
      { cell: 10, run: "loop", atMeters: 10 },
      { cell: 19, run: "loop", atMeters: 19 },
    ]);

    expect(cells).toHaveLength(20);
    expect(() =>
      fitRunMapping(run, 20, [
        { cell: 0, run: "loop", atMeters: 10 },
        { cell: 5, run: "loop", atMeters: 4 },
      ]),
    ).toThrow(/non-monotonic/);
  });

  it("keeps cells outside the anchored span ordered (slope extrapolation)", () => {
    const run = square();
    const anchors = [
      { cell: 5, run: "loop", atMeters: 0 },
      { cell: 15, run: "loop", atMeters: 20 },
    ];
    const cells = fitRunMapping(run, 20, anchors);
    const startOf = (i: number): number => cells[i]!.positions[0]!.startM;
    // A uniform fallback put cell 4 ahead of the anchored cell 5; the
    // anchored slope keeps order non-decreasing across the whole run.
    expect(startOf(4)).toBeLessThanOrEqual(startOf(5));
    for (let i = 1; i < 20; i++) expect(startOf(i)).toBeGreaterThanOrEqual(startOf(i - 1));
    // A single anchor has no slope; the fallback clamps to it instead.
    const single = fitRunMapping(run, 20, [{ cell: 5, run: "loop", atMeters: 0 }]);
    expect(single[4]!.positions[0]!.startM).toBeLessThanOrEqual(single[5]!.positions[0]!.startM);
  });

  it("keeps physical to logical a bijection and rotates it on logical-zero move", () => {
    const run = square();
    const cells = fitRunMapping(run, 8, []);
    const midS = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875];
    const ordered = applyLogicalOrder(cells, midS, 0, "clockwise");
    const table = logicalToPhysical(ordered);
    expect([...table].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    const rotated = rotateLogicalZero(ordered, 2);
    expect(logicalToPhysical(rotated)).not.toEqual(table);
    expect(orderLogical(midS, 0.25, "clockwise")[2]).toBe(0);
  });

  it("classifies strip topology without assuming the owner's rig", () => {
    expect(topologyForRuns([square()])).toBe("closed-loop");
    expect(topologyForRuns([{ ...square(), closed: false }])).toBe("open-path");
    expect(topologyForRuns([square(), { ...square(), id: "b", mirroredOf: "loop" }])).toBe("split-mirrored");
    expect(topologyForRuns([square(), { ...square(), id: "b" }])).toBe("split-independent");
  });
});
