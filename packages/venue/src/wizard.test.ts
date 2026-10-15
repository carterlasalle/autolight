import { describe, expect, it } from "vitest";
import { classifyDirection, mirrorCheck, runWizardOnSim, verifyOffset } from "./wizard.js";
import { rectangleRoom } from "./room.js";
import { outlineRuns } from "./venue.js";
import type { SimStrip } from "./wizard.js";
import type { Run } from "./placement.js";

// The rectangle fixture must yield exactly one closed outline run: a guard
// with a clear message beats non-null assertions that turn a fixture change
// into NaN arithmetic downstream.
function singleRun(room: Parameters<typeof outlineRuns>[0]): Run {
  const run = outlineRuns(room, 2.5)[0];

  if (run === undefined) throw new Error("rectangleRoom must yield one outline run");

  return run;
}

// Closed-loop length of a run, first point re-joined to the last.
function closedLength(run: Run): number {
  const first = run.polyline[0];

  if (first === undefined) throw new Error("outline run has an empty polyline");

  let total = 0;
  let prev = first;

  for (const point of run.polyline.slice(1)) {
    total += Math.hypot(point.x - prev.x, point.y - prev.y);
    prev = point;
  }

  return total + Math.hypot(first.x - prev.x, first.y - prev.y);
}

function simStrip(cells: number, mirrored = false, gaps: SimStrip["gaps"] = []): { strip: SimStrip; total: number } {
  const run = singleRun(rectangleRoom(5, 5));
  const total = closedLength(run);

  return {
    strip: { cellCount: cells, cellToArcM: Array.from({ length: cells }, (_, i) => ((i + 0.5) / cells) * total), mirrored, gaps: [...gaps] },
    total,
  };
}

describe("T-ROOM-04 strip mapping wizard", () => {
  it("recovers a hidden SIM mapping within one cell", () => {
    const { strip, total } = simStrip(30);
    const run = singleRun(rectangleRoom(5, 5));
    const corners = [0, total / 4, total / 2, (3 * total) / 4];
    const fit = runWizardOnSim(strip, run, corners, 0, "clockwise");
    // maxErrCells is measured in cell pitches, so < 1 means every fitted
    // cell midpoint lands within one pitch of its declared arc position.
    expect(fit.maxErrCells).toBeLessThan(1);
    expect(fit.topology).toBe("single");
    expect(fit.orbitAllowed).toBe(true);
  });

  it("recovers the SIM mapping from an independent analytic ground truth", () => {
    // The 2.5 m inset outline of a 5x5 room is a 5x5 rectangle: perimeter
    // 20 m, known analytically, not derived from the run being fitted.
    const run = singleRun(rectangleRoom(5, 5));
    const total = 20;
    const cellCount = 20;
    const strip: SimStrip = {
      cellCount,
      cellToArcM: Array.from({ length: cellCount }, (_, i) => ((i + 0.5) / cellCount) * total),
      mirrored: false,
      gaps: [],
    };
    const corners = [0, total / 4, total / 2, (3 * total) / 4];
    const fit = runWizardOnSim(strip, run, corners, 0, "clockwise");
    const pitch = total / cellCount;

    expect(fit.maxErrCells).toBeLessThan(1);
    // Every cell's fitted arc midpoint must sit within one pitch of its
    // declared arc position: the specific recovered values, not just a fit.
    for (const cell of fit.cells) {
      const position = cell.positions[0];

      if (position === undefined) throw new Error(`cell ${cell.physicalIndex} has no position`);
      const mid = (position.startM + position.endM) / 2;
      const truth = strip.cellToArcM[cell.physicalIndex];

      if (truth === undefined) throw new Error(`no truth arc for cell ${cell.physicalIndex}`);
      expect(Math.abs(mid - truth)).toBeLessThan(pitch);
    }
  });

  it("classifies a mirrored SIM strip and disables orbits with the reason", () => {
    const { strip, total } = simStrip(30, true);
    const run = singleRun(rectangleRoom(5, 5));
    const fit = runWizardOnSim(strip, run, [total / 4], 0, "clockwise");
    expect(fit.topology).toBe("split-mirrored");
    expect(fit.orbitAllowed).toBe(false);
    const check = mirrorCheck(2);
    expect(check.orbitAllowed).toBe(false);
    expect(check.offered).toContain("SymmetricSweep");
  });

  it("reports a fine offset when the verify orbit drifts", () => {
    const ok = verifyOffset([0.1, 0.2], [0.1, 0.2], 0.05);
    expect(ok.ok).toBe(true);
    const off = verifyOffset([0.3, 0.4], [0.1, 0.2], 0.01);
    expect(off.ok).toBe(false);
    // One sample: every integer shift aliases a full lap, and dyadic values
    // keep the comparison exact, so no shift beats staying put.
    expect(verifyOffset([0.25], [0], 0.1)).toEqual({ ok: false, suggestShift: 0 });
    // Five samples with a uniform 0.2 lead: only s = -1 (one fifth of the
    // ring) aligns the head, and the sign must come out negative.
    const aligned = verifyOffset([0.6, 0.65, 0.7, 0.75, 0.8], [0.4, 0.45, 0.5, 0.55, 0.6], 0.01);
    expect(aligned.ok).toBe(false);
    expect(aligned.suggestShift).toBe(-1);
  });

  it("covers direction classification, offset edge cases, and a gapped run", () => {
    expect(classifyDirection("clockwise")).toBe("single");
    expect(classifyDirection("counterclockwise")).toBe("single");
    expect(classifyDirection("both")).toBe("split-independent");
    // Empty and mismatched inputs are explicit refusals, never a shift guess.
    expect(verifyOffset([], [], 0.05)).toEqual({ ok: false, suggestShift: 0 });
    expect(verifyOffset([0.1, 0.2], [0.1], 0.05)).toEqual({ ok: false, suggestShift: 0 });
    // A value running past the ring still measures the short way around.
    expect(verifyOffset([1.1], [0.1], 0.01).ok).toBe(true);

    // A run with a physical gap still maps: the gap sits between cell
    // midpoints (4.5 m and 5.5 m), so it travels through the mapping
    // without distorting cell anchoring.
    const run: Run = {
      id: "r-gap",
      polyline: [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }],
      closed: false,
      mirroredOf: null,
      gaps: [{ fromM: 4.9, toM: 5.1 }],
    };
    const strip: SimStrip = {
      cellCount: 10,
      cellToArcM: Array.from({ length: 10 }, (_, i) => i + 0.5),
      mirrored: false,
      gaps: [{ fromM: 4.9, toM: 5.1 }],
    };
    const fit = runWizardOnSim(strip, run, [0, 5, 10], 0, "clockwise");
    expect(fit.cells).toHaveLength(10);
    expect(fit.maxErrCells).toBeLessThan(1);
  });
});
