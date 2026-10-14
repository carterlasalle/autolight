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
    // Interpolation, not just length: anchors mark cell CENTERS (cell 10 is
    // at 10 m), so a cell's span starts half a cell earlier; cell 0 clamps
    // to the run start.
    const startOf = (i: number): number => cells[i]!.positions[0]!.startM;

    expect(startOf(0)).toBeCloseTo(0, 9);
    expect(startOf(5)).toBeCloseTo(4.5, 9);
    expect(startOf(10)).toBeCloseTo(9.5, 9);
    expect(startOf(15)).toBeCloseTo(14.5, 9);
    expect(startOf(19)).toBeCloseTo(18.5, 9);
    expect(startOf(5)).toBeGreaterThan(startOf(0));
    expect(startOf(5)).toBeLessThan(startOf(10));
    expect(startOf(15)).toBeLessThan(startOf(19));
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
    // Derived from the fitted cells, not hand-written: one s value per cell.
    const midS = cells.map((_, i) => i / cells.length);
    const ordered = applyLogicalOrder(cells, midS, 0, "clockwise");
    const table = logicalToPhysical(ordered);
    expect([...table].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    const rotated = rotateLogicalZero(ordered, 2);
    const rotatedTable = logicalToPhysical(rotated);
    expect(rotatedTable).not.toEqual(table);
    // Rotating the zero by 2 moves every physical cell two logical slots:
    // rotatedTable[i] === table[(i + 2) % 8] for the whole table.
    expect([...rotatedTable]).toEqual([...table].map((_, i) => table[(i + 2) % table.length]));
    // The full orderLogical permutation, not one index: physical 2 sits at
    // logical 0 on the uniform ring with zero at 0.25, neighbours stay
    // neighbours, and the mapping covers every slot once.
    const fullOrder = orderLogical(midS, 0.25, "clockwise");
    expect(fullOrder[2]).toBe(0);
    expect([...fullOrder].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);

    for (let i = 0; i + 1 < fullOrder.length; i++) {
      expect((fullOrder[i + 1]! - fullOrder[i]! + 8) % 8).toBe(1);
    }
  });

  it("classifies strip topology without assuming the owner's rig", () => {
    expect(topologyForRuns([])).toBe("point");
    expect(topologyForRuns([square()])).toBe("closed-loop");
    expect(topologyForRuns([{ ...square(), closed: false }])).toBe("open-path");
    expect(topologyForRuns([square(), { ...square(), id: "b", mirroredOf: "loop" }])).toBe("split-mirrored");
    expect(topologyForRuns([square(), { ...square(), id: "b" }])).toBe("split-independent");
  });
});
