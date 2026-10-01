import { pointCells, runPointAt } from "./fields.js";
import type { FieldCell } from "./fields.js";
import type { Run } from "./placement.js";
import { rectangleRoom } from "./room.js";
import type { Room } from "./room.js";
import { outlineRuns } from "./venue.js";

export interface ReferenceRoom {
  id: string;
  room: Room;
  runs: Run[];
  stripCells: number;
  lampPositions: { x: number; y: number; z: number }[];
  seamS: number;
  zeroS: number;
  gaps: { run: string; fromM: number; toM: number }[];
  mirrored: boolean;
  describe: string;
}

function loopRun(room: Room, z: number, opts: { closed?: boolean; id?: string; mirroredOf?: string | null; gaps?: { fromM: number; toM: number }[]; controllerS?: number } = {}): Run[] {
  const runs = outlineRuns(room, z);
  const run = runs[0]!;
  run.id = opts.id ?? run.id;
  run.closed = opts.closed ?? true;
  run.mirroredOf = opts.mirroredOf ?? null;
  run.gaps = opts.gaps;
  run.controllerS = opts.controllerS;
  return [run];
}

export function squareRoom(): ReferenceRoom {
  const room = rectangleRoom(5, 5, "Square room");
  return {
    id: "square-loop",
    room,
    runs: loopRun(room, 2.5, { controllerS: 0.375 }),
    stripCells: 30,
    lampPositions: [],
    seamS: 0.375,
    zeroS: 0,
    gaps: [],
    mirrored: false,
    describe: "5 m square, closed ceiling loop, controller mid-wall left, DJ mid-wall front",
  };
}

export function squareMirrored(): ReferenceRoom {
  const base = squareRoom();
  const runs = loopRun(base.room, 2.5, { closed: false });
  const a = { ...runs[0]!, id: "run-a", mirroredOf: null };
  const b = { ...runs[0]!, id: "run-b", mirroredOf: "run-a" };
  return {
    ...base,
    id: "square-mirrored",
    runs: [a, b],
    mirrored: true,
    describe: "5 m square with a Y-split mirrored strip",
  };
}

export function squareChunks(): ReferenceRoom {
  const room = rectangleRoom(5, 5, "Chunked square");
  const runs = outlineRuns(room, 2.5);
  const run = runs[0]!;
  const total = 20;
  run.gaps = [
    { fromM: total * 0.2, toM: total * 0.25 },
    { fromM: total * 0.6, toM: total * 0.68 },
  ];
  return {
    id: "square-chunks",
    room,
    runs,
    stripCells: 30,
    lampPositions: [
      { x: -2, y: 2, z: 0 },
      { x: 2, y: 2, z: 0 },
    ],
    seamS: 0,
    zeroS: 0,
    gaps: run.gaps.map((g) => ({ run: run.id, fromM: g.fromM, toM: g.toM })),
    mirrored: false,
    describe: "square with seam at a corner, three cut pieces with two dark gaps, two back-corner lamps",
  };
}

export function clubRectangle(): ReferenceRoom {
  const room = rectangleRoom(6, 10, "Club rectangle");
  const runs = outlineRuns(room, 2.8);
  runs[0]!.gaps = [{ fromM: 2, toM: 3.4 }];
  return {
    id: "club-rectangle",
    room,
    runs,
    stripCells: 48,
    lampPositions: [{ x: -2, y: 4, z: 0 }],
    seamS: 0.1,
    zeroS: 0,
    gaps: [{ run: runs[0]!.id, fromM: 2, toM: 3.4 }],
    mirrored: false,
    describe: "6 by 10 m rectangle with a gap over the door",
  };
}

export function lRoom(): ReferenceRoom {
  const room = rectangleRoom(6, 6, "L room");
  room.outline = [
    { x: -3, y: -3 },
    { x: -3, y: 3 },
    { x: 0, y: 3 },
    { x: 0, y: 0 },
    { x: 3, y: 0 },
    { x: 3, y: -3 },
  ];
  room.wallNames = ["W0", "W1", "W2", "W3", "W4", "W5"];
  return {
    id: "l-room",
    room,
    runs: outlineRuns(room, 2.5),
    stripCells: 36,
    lampPositions: [],
    seamS: 0,
    zeroS: 0,
    gaps: [],
    mirrored: false,
    describe: "L-shaped room",
  };
}

export function curvedRoom(): ReferenceRoom {
  const room = rectangleRoom(5, 5, "Curved wall room");
  const runs = outlineRuns(room, 2.5);
  runs[0]!.geom = { kind: "catmull-rom" };
  return {
    id: "curved-room",
    room,
    runs,
    stripCells: 30,
    lampPositions: [],
    seamS: 0,
    zeroS: 0,
    gaps: [],
    mirrored: false,
    describe: "square room with a curved spline wall",
  };
}

export const REFERENCE_ROOMS: ReferenceRoom[] = [
  squareRoom(),
  squareMirrored(),
  squareChunks(),
  clubRectangle(),
  lRoom(),
  curvedRoom(),
];

export function referenceById(id: string): ReferenceRoom {
  const found = REFERENCE_ROOMS.find((r) => r.id === id);
  if (!found) throw new Error(`unknown reference room ${id}`);
  return found;
}

export function fieldCellsForReference(ref: ReferenceRoom): { cells: FieldCell[]; midS: number[] } {
  const run = ref.runs[0]!;
  const total = runLengthOf(run);
  const cells: FieldCell[] = [];
  const midS: number[] = [];
  for (let i = 0; i < ref.stripCells; i++) {
    const arcM = ((i + 0.5) / ref.stripCells) * total;
    const at = runPointAt(run, arcM);
    const s = arcFraction(run, arcM);
    cells.push({
      fixtureId: "strip",
      physicalIndex: i,
      logicalIndex: i,
      pos: { ...at.p },
      extentStart: runPointAt(run, (i / ref.stripCells) * total).p,
      extentEnd: runPointAt(run, ((i + 1) / ref.stripCells) * total).p,
      runId: run.id,
      arcM,
      chain: i,
    });
    midS.push(s);
  }
  for (let l = 0; l < ref.lampPositions.length; l++) {
    const p = ref.lampPositions[l]!;
    cells.push({
      fixtureId: `lamp${l}`,
      physicalIndex: 0,
      logicalIndex: ref.stripCells + l,
      pos: { x: p.x, y: p.y, z: 1.2 },
      extentStart: { x: p.x, y: p.y, z: 0 },
      extentEnd: { x: p.x, y: p.y, z: 2.4 },
      runId: null,
      arcM: 0,
      chain: 0,
    });
    midS.push(lampS(ref.room, p));
  }
  return { cells, midS };
}

function runLengthOf(run: Run): number {
  const pts = run.closed ? [...run.polyline, run.polyline[0]!] : run.polyline;
  let len = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    len += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }
  return Math.max(1e-9, len);
}

function arcFraction(run: Run, arcM: number): number {
  return (((arcM / runLengthOf(run)) % 1) + 1) % 1;
}

function lampS(room: Room, p: { x: number; y: number }): number {
  const outline = room.outline;
  let best = 0;
  let bestD = Infinity;
  let acc = 0;
  let total = 0;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i]!;
    const b = outline[(i + 1) % outline.length]!;
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i]!;
    const b = outline[(i + 1) % outline.length]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy || 1e-9;
    const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    const d = Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
    const seg = Math.sqrt(len2);
    if (d < bestD) { bestD = d; best = (acc + seg * t) / Math.max(1e-9, total); }
    acc += seg;
  }
  return best;
}

export function lampCells(fixtureId: string, positions: { x: number; y: number; z: number }[]): FieldCell[] {
  return pointCells(fixtureId, positions);
}
