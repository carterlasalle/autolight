import { describe, expect, it } from "vitest";
import { mirrorCheck, runWizardOnSim, verifyOffset } from "./wizard.js";
import { rectangleRoom } from "./room.js";
import { outlineRuns } from "./venue.js";
import type { SimStrip } from "./wizard.js";

function simStrip(cells: number, mirrored = false, gaps: SimStrip["gaps"] = []): { strip: SimStrip; total: number } {
  const room = rectangleRoom(5, 5);
  const run = outlineRuns(room, 2.5)[0]!;
  const pts = [...run.polyline, run.polyline[0]!];
  let total = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    total += Math.hypot(pts[i + 1]!.x - pts[i]!.x, pts[i + 1]!.y - pts[i]!.y);
  }
  void gaps;
  return {
    strip: { cellCount: cells, cellToArcM: Array.from({ length: cells }, (_, i) => ((i + 0.5) / cells) * total), mirrored, gaps: [] },
    total,
  };
}

describe("T-ROOM-04 strip mapping wizard", () => {
  it("recovers a hidden SIM mapping within one cell", () => {
    const { strip, total } = simStrip(30);
    const room = rectangleRoom(5, 5);
    const run = outlineRuns(room, 2.5)[0]!;
    const corners = [0, total / 4, total / 2, (3 * total) / 4];
    const fit = runWizardOnSim(strip, run, corners, 0, "clockwise");
    expect(fit.maxErrCells).toBeLessThan(1);
    expect(fit.topology).toBe("single");
    expect(fit.orbitAllowed).toBe(true);
  });

  it("classifies a mirrored SIM strip and disables orbits with the reason", () => {
    const { strip, total } = simStrip(30, true);
    const room = rectangleRoom(5, 5);
    const run = outlineRuns(room, 2.5)[0]!;
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
  });
});
