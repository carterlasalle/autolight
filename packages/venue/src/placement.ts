import type { Fixture } from "@autolight/contracts";
import type { Point2, Point3, SplineGeom } from "./room.js";
import { polylineLength } from "./room.js";

export type Topology =
  | "vertical-line"
  | "open-path"
  | "closed-loop"
  | "split-independent"
  | "split-mirrored"
  | "point"
  | "grid";

export interface Run {
  id: string;
  polyline: Point3[];
  closed: boolean;
  mirroredOf: string | null;
  geom?: SplineGeom;
  gaps?: { fromM: number; toM: number }[];
  controllerS?: number;
}

export type Placement =
  | { kind: "point"; position: Point3 }
  | { kind: "vertical"; base: Point2; z0: number; z1: number }
  | { kind: "path"; runs: Run[] };

export interface CellAnchor {
  cell: number;
  run: string;
  atMeters: number;
}

export interface CellPosition {
  run: string;
  startM: number;
  endM: number;
}

export interface MappedCell {
  physicalIndex: number;
  logicalIndex: number;
  positions: CellPosition[];
}

export interface CellMap {
  resolution: "logical" | "grouped" | "native";
  zones: number;
  anchors: CellAnchor[];
  gaps: { run: string; fromM: number; toM: number }[];
  cells: MappedCell[];
}

export interface FixtureTransform {
  rotationDeg: number;
  reverse: boolean;
}

export interface FixtureCapability {
  zones: number;
  maxDistinctColoursPerFrame: number | null;
  maxRateHz: number | null;
  singleZone: boolean;
}

export interface VenueFixture {
  fixture: Fixture;
  placement: Placement;
  cellMap: CellMap | null;
  topology: Topology;
  transform?: FixtureTransform;
  capabilities?: FixtureCapability;
}

export function runLength(run: Run, toleranceM = 0.005): number {
  const pts = run.closed ? [...run.polyline, run.polyline[0]!] : run.polyline;
  return polylineLength(pts, run.geom, toleranceM);
}

export function gapLength(gaps: { fromM: number; toM: number }[] | undefined): number {
  if (!gaps) return 0;
  return gaps.reduce((a, g) => a + Math.max(0, g.toM - g.fromM), 0);
}

function subtractGaps(len: number, gaps: { fromM: number; toM: number }[]): { start: number; end: number }[] {
  const sorted = [...gaps].sort((a, b) => a.fromM - b.fromM);
  const out: { start: number; end: number }[] = [];
  let cursor = 0;
  for (const g of sorted) {
    if (g.fromM > cursor) out.push({ start: cursor, end: Math.min(g.fromM, len) });
    cursor = Math.max(cursor, g.toM);
  }
  if (cursor < len) out.push({ start: cursor, end: len });
  return out.filter((s) => s.end > s.start);
}

function arcToUsable(usable: { start: number; end: number }[], arc: number): number {
  let acc = 0;
  for (const s of usable) {
    if (arc >= s.start && arc <= s.end) return acc + (arc - s.start);
    acc += s.end - s.start;
  }
  return acc;
}

function usableToArc(usable: { start: number; end: number }[], u: number): number {
  for (const s of usable) {
    const w = s.end - s.start;
    if (u <= w) return s.start + u;
    u -= w;
  }
  const last = usable[usable.length - 1]!;
  return last.end;
}

export function fitRunMapping(
  run: Run,
  cellCount: number,
  anchors: CellAnchor[],
): MappedCell[] {
  const len = runLength(run);
  const usable = subtractGaps(len, run.gaps ?? []);
  const usableLen = usable.reduce((a, s) => a + (s.end - s.start), 0);
  const mine = anchors.filter((a) => a.run === run.id).sort((a, b) => a.cell - b.cell);
  for (let i = 0; i + 1 < mine.length; i++) {
    if (mine[i + 1]!.atMeters <= mine[i]!.atMeters || mine[i + 1]!.cell <= mine[i]!.cell) {
      throw new Error(
        `non-monotonic fit on run ${run.id}: anchor cell ${mine[i]!.cell}@${mine[i]!.atMeters}m precedes cell ${mine[i + 1]!.cell}@${mine[i + 1]!.atMeters}m`,
      );
    }
  }
  const anchorU = mine.map((a) => ({ cell: a.cell, u: arcToUsable(usable, a.atMeters) }));
  const posOf = (cell: number): number => {
    const exact = anchorU.find((a) => a.cell === cell);
    if (exact) return exact.u;
    let lo: { cell: number; u: number } | null = null;
    let hi: { cell: number; u: number } | null = null;
    for (const a of anchorU) {
      if (a.cell < cell) lo = a;
      if (a.cell > cell && hi === null) hi = a;
    }
    if (lo && hi) {
      const t = (cell - lo.cell) / (hi.cell - lo.cell);
      return lo.u + (hi.u - lo.u) * t;
    }
    return ((cell + 0.5) / Math.max(1, cellCount)) * usableLen;
  };
  const cells: MappedCell[] = [];
  for (let i = 0; i < cellCount; i++) {
    const centerU = posOf(i);
    const half = usableLen / Math.max(1, cellCount) / 2;
    const startM = usableToArc(usable, Math.max(0, centerU - half));
    const endM = usableToArc(usable, Math.min(usableLen, centerU + half));
    cells.push({ physicalIndex: i, logicalIndex: i, positions: [{ run: run.id, startM, endM }] });
  }
  return cells;
}

export function cellMidM(cell: MappedCell): number {
  const p = cell.positions[0]!;
  return (p.startM + p.endM) / 2;
}

export function orderLogical(midS: number[], zeroS: number, direction: "clockwise" | "counterclockwise"): number[] {
  const n = midS.length;
  const rel = midS.map((s) => {
    const d = direction === "clockwise" ? s - zeroS : zeroS - s;
    return ((d % 1) + 1) % 1;
  });
  const order = rel.map((_, i) => i).sort((a, b) => rel[a]! - rel[b]!);
  const logical = new Array<number>(n);
  order.forEach((physical, logicalIndex) => {
    logical[physical] = logicalIndex;
  });
  return logical;
}

export function applyLogicalOrder(cells: MappedCell[], midS: number[], zeroS: number, direction: "clockwise" | "counterclockwise"): MappedCell[] {
  const logical = orderLogical(midS, zeroS, direction);
  return cells.map((c) => ({ ...c, positions: c.positions.map((p) => ({ ...p })), logicalIndex: logical[c.physicalIndex]! }));
}

export function rotateLogicalZero(cells: MappedCell[], shiftCells: number): MappedCell[] {
  const n = cells.length;
  const shift = ((shiftCells % n) + n) % n;
  return cells.map((c) => ({
    ...c,
    positions: c.positions.map((p) => ({ ...p })),
    logicalIndex: (c.logicalIndex + n - shift) % n,
  }));
}

export function logicalToPhysical(cells: MappedCell[]): Uint32Array {
  const out = new Uint32Array(cells.length);
  for (const c of cells) out[c.logicalIndex] = c.physicalIndex;
  return out;
}

export function topologyForRuns(runs: Run[]): Topology {
  if (runs.length === 0) return "point";
  if (runs.length === 1) return runs[0]!.closed ? "closed-loop" : "open-path";
  if (runs.some((r) => r.mirroredOf !== null)) return "split-mirrored";
  return "split-independent";
}

export function migrateFixture(f: Fixture): VenueFixture {
  const cells: MappedCell[] = f.cells.map((c) => ({
    physicalIndex: c.index,
    logicalIndex: c.order,
    positions: [],
  }));
  const topology: Topology = f.cells.length <= 1 ? "point" : "open-path";
  const placement: Placement =
    f.cells.length === 1
      ? { kind: "point", position: { x: f.cells[0]!.position.x, y: f.cells[0]!.position.y ?? 0, z: f.cells[0]!.position.z ?? 0 } }
      : {
          kind: "path",
          runs: [
            {
              id: `${f.id}-run0`,
              polyline: f.cells.map((c) => ({ x: c.position.x, y: c.position.y ?? 0, z: c.position.z ?? 0 })),
              closed: false,
              mirroredOf: null,
            },
          ],
        };
  return {
    fixture: f,
    placement,
    cellMap: { resolution: "native", zones: f.cells.length, anchors: [], gaps: [], cells },
    topology,
  };
}
