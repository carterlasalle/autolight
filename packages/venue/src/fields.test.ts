import { describe, expect, it } from "vitest";
import { computeFields, outlinePoint, projectToOutline, runPointAt } from "./fields.js";
import type { FieldCell } from "./fields.js";
import { outlineRuns } from "./venue.js";
import { rectangleRoom } from "./room.js";

function stripCells(n: number, room = rectangleRoom(5, 5)): { cells: FieldCell[]; midS: number[] } {
  const runs = outlineRuns(room, 2.5);
  const run = runs[0]!;
  const cells: FieldCell[] = [];
  const midS: number[] = [];
  let total = 0;
  const pts = [...run.polyline, run.polyline[0]!];
  for (let i = 0; i + 1 < pts.length; i++) {
    total += Math.hypot(pts[i + 1]!.x - pts[i]!.x, pts[i + 1]!.y - pts[i]!.y);
  }
  for (let i = 0; i < n; i++) {
    const arcM = ((i + 0.5) / n) * total;
    const at = runPointAt(run, arcM);
    const proj = projectToOutline(at.p, room.outline);
    cells.push({
      fixtureId: "strip", physicalIndex: i, logicalIndex: i,
      pos: { ...at.p }, extentStart: { ...at.p }, extentEnd: { ...at.p },
      runId: run.id, arcM, chain: i,
    });
    midS.push(proj.s);
  }
  return { cells, midS };
}

describe("T-ROOM-05 spatial field computation", () => {
  it("wraps s continuously on closed loops", () => {
    const room = rectangleRoom(5, 5);
    const { cells } = stripCells(20, room);
    const f = computeFields(room, cells, outlineRuns(room, 2.5), { zeroS: 0 });
    let worst = 0;
    for (let i = 0; i < 20; i++) {
      const a = f.s[i]!;
      const b = f.s[(i + 1) % 20]!;
      worst = Math.max(worst, Math.min(Math.abs(b - a), 1 - Math.abs(b - a)));
    }
    expect(worst).toBeLessThan(0.08);
  });

  it("gives geodesic distance symmetry with a half-perimeter cap", () => {
    const room = rectangleRoom(5, 5);
    const { cells } = stripCells(20, room);
    const f = computeFields(room, cells, outlineRuns(room, 2.5), { zeroS: 0 });
    for (let i = 0; i < 20; i++) expect(f.gDj[i]).toBeLessThanOrEqual(1 + 1e-6);
    expect(Math.min(...f.gDj)).toBeLessThan(0.35);
    expect(Math.max(...f.gDj)).toBeCloseTo(1, 1);
    const sorted = [...f.gDj].sort((a, b) => a - b);
    expect(Math.abs(sorted[0]! - sorted[1]!)).toBeLessThan(0.15);
    expect(Math.abs(sorted[sorted.length - 1]! - sorted[sorted.length - 2]!)).toBeLessThan(0.15);
  });

  it("projects a corner lamp to the corner s", () => {
    const room = rectangleRoom(5, 5);
    const lamp = {
      fixtureId: "lamp", physicalIndex: 0, logicalIndex: 0,
      pos: { x: -2.5, y: 2.5, z: 1 }, extentStart: { x: -2.5, y: 2.5, z: 0 }, extentEnd: { x: -2.5, y: 2.5, z: 2 },
      runId: null, arcM: 0, chain: 0,
    };
    const f = computeFields(room, [lamp], outlineRuns(room, 2.5), { zeroS: 0 });
    const corner = projectToOutline({ x: -2.5, y: 2.5 }, room.outline);
    expect(f.s[0]).toBeCloseTo(((corner.s % 1) + 1) % 1, 6);
  });

  it("flips uv left and right when the DJ turns 180 degrees", () => {
    const room = rectangleRoom(5, 5);
    const { cells } = stripCells(8, room);
    const runs = outlineRuns(room, 2.5);
    const a = computeFields(room, cells, runs, { zeroS: 0 });
    const turned = { ...room, anchors: { ...room.anchors, dj: { position: room.anchors.dj.position, facingRad: room.anchors.dj.facingRad + Math.PI } } };
    const b = computeFields(turned, cells, runs, { zeroS: 0 });
    expect(a.uv[0]).toBeCloseTo(1 - b.uv[0]!, 6);
  });

  it("keeps tangents unit length and turns them at corners", () => {
    const room = rectangleRoom(5, 5);
    const { cells } = stripCells(20, room);
    const f = computeFields(room, cells, outlineRuns(room, 2.5), { zeroS: 0 });
    for (let i = 0; i < 20; i++) {
      expect(Math.hypot(f.tangent[i * 2]!, f.tangent[i * 2 + 1]!)).toBeCloseTo(1, 6);
    }
    expect(Math.abs(f.tangent[0]! - f.tangent[10]!)).toBeGreaterThan(0.5);
  });

  it("changes signedSplit sign exactly at the split line", () => {
    const room = rectangleRoom(5, 5);
    const { cells } = stripCells(8, room);
    const f = computeFields(room, cells, outlineRuns(room, 2.5), { zeroS: 0 });
    const signs = [...f.signedSplit].map((v) => (v >= 0 ? 1 : -1));
    expect(new Set(signs).size).toBe(2);
  });

  it("rotates logical order on zero move without moving positions", () => {
    const room = rectangleRoom(5, 5);
    const { cells } = stripCells(8, room);
    const runs = outlineRuns(room, 2.5);
    const a = computeFields(room, cells, runs, { zeroS: 0 });
    const b = computeFields(room, cells, runs, { zeroS: 0.25 });
    expect([...a.pos]).toEqual([...b.pos]);
    expect([...a.s]).not.toEqual([...b.s]);
  });

  it("computes 2000 cells inside the field budget", () => {
    const room = rectangleRoom(5, 5);
    const { cells } = stripCells(2000, room);
    const start = performance.now();
    computeFields(room, cells, outlineRuns(room, 2.5), { zeroS: 0 });
    expect(performance.now() - start).toBeLessThan(500);
  });

  it("samples outline points on the perimeter", () => {
    const room = rectangleRoom(5, 5);
    const p = outlinePoint(room.outline, 0.25);
    expect(Math.abs(Math.abs(p.x) - 2.5) < 0.01 || Math.abs(Math.abs(p.y) - 2.5) < 0.01).toBe(true);
  });
});
