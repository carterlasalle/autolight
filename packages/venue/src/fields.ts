import type { MappedCell, Run } from "./placement.js";
import { runLength } from "./placement.js";
import type { Point2, Room } from "./room.js";
import { normalizeOutline, perimeterLength, polygonCentroid, roomCenter } from "./room.js";

export interface FieldCell {
  fixtureId: string;
  physicalIndex: number;
  logicalIndex: number;
  pos: Point2 & { z: number };
  extentStart: Point2 & { z: number };
  extentEnd: Point2 & { z: number };
  runId: string | null;
  arcM: number;
  chain: number;
}

export interface VenueFields {
  version: number;
  count: number;
  keys: string[];
  pos: Float32Array;
  extent: Float32Array;
  uv: Float32Array;
  h: Float32Array;
  s: Float32Array;
  theta: Float32Array;
  dCenter: Float32Array;
  dDj: Float32Array;
  gDj: Float32Array;
  wall: Int16Array;
  wallPos: Float32Array;
  corner: Float32Array;
  side: Uint8Array;
  frontBack: Uint8Array;
  chain: Float32Array;
  physical: Uint32Array;
  logical: Uint32Array;
  tangent: Float32Array;
  signedSplit: Float32Array;
  perimeterLen: number;
  maxDist: number;
}

export const SIDE_LEFT = 0;
export const SIDE_CENTER = 1;
export const SIDE_RIGHT = 2;

export interface FieldOptions {
  version?: number;
  zeroS?: number;
  direction?: "clockwise" | "counterclockwise";
  splitAngleRad?: number;
  centerBandWidth?: number;
  pivot?: Point2;
}

function outlineCum(outline: Point2[]): { cum: number[]; total: number } {
  const cum: number[] = [0];
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i]!;
    const b = outline[(i + 1) % outline.length]!;
    cum.push(cum[i]! + Math.hypot(b.x - a.x, b.y - a.y));
  }
  return { cum, total: cum[cum.length - 1]! };
}

export function projectToOutline(
  p: Point2,
  outline: Point2[],
): { s: number; wall: number; wallPos: number; corner: number } {
  const { cum, total } = outlineCum(outline);
  const safe = Math.max(1e-9, total);
  let bestWall = 0;
  let bestT = 0;
  let bestD2 = Infinity;
  let bestSegLen = 1;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i]!;
    const b = outline[(i + 1) % outline.length]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 < 1e-12 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    const px = a.x + dx * t;
    const py = a.y + dy * t;
    const d2 = (p.x - px) * (p.x - px) + (p.y - py) * (p.y - py);
    if (d2 < bestD2) {
      bestD2 = d2;
      bestWall = i;
      bestT = t;
      bestSegLen = Math.sqrt(len2);
    }
  }
  return {
    s: (cum[bestWall]! + bestSegLen * bestT) / safe,
    wall: bestWall,
    wallPos: bestT,
    corner: Math.min(bestT, 1 - bestT) * bestSegLen,
  };
}

function outlinePointAt(outline: Point2[], s: number): { p: Point2; tangent: Point2 } {
  const { cum, total } = outlineCum(outline);
  const d = (((s % 1) + 1) % 1) * Math.max(1e-9, total);
  for (let i = 0; i < outline.length; i++) {
    if (d >= cum[i]! && d <= cum[i + 1]!) {
      const a = outline[i]!;
      const b = outline[(i + 1) % outline.length]!;
      const seg = Math.max(1e-9, cum[i + 1]! - cum[i]!);
      const t = (d - cum[i]!) / seg;
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      return {
        p: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
        tangent: { x: (b.x - a.x) / len, y: (b.y - a.y) / len },
      };
    }
  }
  const a = outline[0]!;
  const b = outline[1] ?? outline[0]!;
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { p: { ...a }, tangent: { x: (b.x - a.x) / len, y: (b.y - a.y) / len } };
}

export function outlinePoint(outline: Point2[], s: number): Point2 {
  return outlinePointAt(outline, s).p;
}

export function runPointAt(
  run: Run,
  arcM: number,
): { p: { x: number; y: number; z: number }; tangent: Point2 } {
  const pts = run.closed ? [...run.polyline, run.polyline[0]!] : run.polyline;
  const total = Math.max(1e-9, runLength(run));
  const d = run.closed ? (((arcM % total) + total) % total) : Math.min(Math.max(0, arcM), total);
  let acc = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const seg = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    if (d <= acc + seg || i === pts.length - 2) {
      const t = seg < 1e-9 ? 0 : (d - acc) / seg;
      const planar = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      return {
        p: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t },
        tangent: { x: (b.x - a.x) / planar, y: (b.y - a.y) / planar },
      };
    }
    acc += seg;
  }
  const last = pts[pts.length - 1]!;
  return { p: { ...last }, tangent: { x: 1, y: 0 } };
}

export function computeFields(
  room: Room,
  cells: FieldCell[],
  runs: Run[],
  opts: FieldOptions = {},
): VenueFields {
  const outline = normalizeOutline(room.outline);
  const total = Math.max(1e-9, perimeterLength(outline));
  const pivot = opts.pivot ?? roomCenter(room);
  const facing = room.anchors.dj.facingRad;
  const zeroS = opts.zeroS ?? room.logicalZeroS ?? 0;
  const direction = opts.direction ?? room.perimeterDirection ?? "clockwise";
  const band = opts.centerBandWidth ?? 0.15;
  const splitAngle = opts.splitAngleRad ?? 0;
  const n = cells.length;
  const runById: Record<string, Run> = {};
  for (const r of runs) runById[r.id] = r;
  let maxDist = 1e-6;
  for (const c of cells) {
    for (const q of outline) maxDist = Math.max(maxDist, Math.hypot(c.pos.x - q.x, c.pos.y - q.y));
  }
  const cosF = Math.cos(-facing);
  const sinF = Math.sin(-facing);
  const rx = (x: number, y: number): number =>
    (x - room.anchors.dj.position.x) * cosF - (y - room.anchors.dj.position.y) * sinF;
  const ry = (x: number, y: number): number =>
    (x - room.anchors.dj.position.x) * sinF + (y - room.anchors.dj.position.y) * cosF;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of outline) {
    const x = rx(p.x, p.y);
    const y = ry(p.x, p.y);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const spanX = Math.max(1e-6, maxX - minX);
  const spanY = Math.max(1e-6, maxY - minY);
  const center = polygonCentroid(outline);
  const djS = projectToOutline(room.anchors.dj.position, outline).s;
  const splitDx = Math.cos(splitAngle + facing);
  const splitDy = Math.sin(splitAngle + facing);
  const f: VenueFields = {
    version: opts.version ?? 1,
    count: n,
    keys: cells.map((c) => `${c.fixtureId}:${c.physicalIndex}`),
    pos: new Float32Array(n * 3),
    extent: new Float32Array(n * 6),
    uv: new Float32Array(n * 2),
    h: new Float32Array(n),
    s: new Float32Array(n),
    theta: new Float32Array(n),
    dCenter: new Float32Array(n),
    dDj: new Float32Array(n),
    gDj: new Float32Array(n),
    wall: new Int16Array(n),
    wallPos: new Float32Array(n),
    corner: new Float32Array(n),
    side: new Uint8Array(n),
    frontBack: new Uint8Array(n),
    chain: new Float32Array(n),
    physical: new Uint32Array(n),
    logical: new Uint32Array(n),
    tangent: new Float32Array(n * 2),
    signedSplit: new Float32Array(n),
    perimeterLen: total,
    maxDist,
  };
  for (let i = 0; i < n; i++) {
    const c = cells[i]!;
    f.pos[i * 3] = c.pos.x;
    f.pos[i * 3 + 1] = c.pos.y;
    f.pos[i * 3 + 2] = c.pos.z;
    f.extent[i * 6] = c.extentStart.x;
    f.extent[i * 6 + 1] = c.extentStart.y;
    f.extent[i * 6 + 2] = c.extentStart.z;
    f.extent[i * 6 + 3] = c.extentEnd.x;
    f.extent[i * 6 + 4] = c.extentEnd.y;
    f.extent[i * 6 + 5] = c.extentEnd.z;
    const lx = rx(c.pos.x, c.pos.y);
    const ly = ry(c.pos.x, c.pos.y);
    f.uv[i * 2] = (lx - minX) / spanX;
    f.uv[i * 2 + 1] = (ly - minY) / spanY;
    f.h[i] = Math.min(1, Math.max(0, c.pos.z / Math.max(1e-6, room.ceilingHeight)));
    let sRaw: number;
    let tangent: Point2 = { x: 1, y: 0 };
    if (c.runId !== null && runById[c.runId] !== undefined) {
      const at = runPointAt(runById[c.runId]!, c.arcM);
      const proj = projectToOutline(at.p, outline);
      sRaw = proj.s;
      tangent = at.tangent;
      f.wall[i] = proj.wall;
      f.wallPos[i] = proj.wallPos;
      f.corner[i] = proj.corner;
    } else {
      const proj = projectToOutline(c.pos, outline);
      sRaw = proj.s;
      tangent = outlinePointAt(outline, sRaw).tangent;
      f.wall[i] = proj.wall;
      f.wallPos[i] = proj.wallPos;
      f.corner[i] = proj.corner;
    }
    const rel = direction === "clockwise" ? sRaw - zeroS : zeroS - sRaw;
    f.s[i] = ((rel % 1) + 1) % 1;
    f.theta[i] = Math.atan2(c.pos.y - pivot.y, c.pos.x - pivot.x) - facing;
    f.dCenter[i] = Math.hypot(c.pos.x - center.x, c.pos.y - center.y) / maxDist;
    f.dDj[i] = Math.hypot(c.pos.x - room.anchors.dj.position.x, c.pos.y - room.anchors.dj.position.y) / maxDist;
    f.gDj[i] = Math.min(Math.abs(sRaw - djS), 1 - Math.abs(sRaw - djS)) * 2;
    const half = (spanX * band) / 2;
    f.side[i] = lx < -half ? SIDE_LEFT : lx > half ? SIDE_RIGHT : SIDE_CENTER;
    f.frontBack[i] = ly >= 0 ? 1 : 0;
    f.chain[i] = c.chain;
    f.physical[i] = c.physicalIndex;
    f.logical[i] = c.logicalIndex;
    const tl = Math.hypot(tangent.x, tangent.y) || 1;
    f.tangent[i * 2] = tangent.x / tl;
    f.tangent[i * 2 + 1] = tangent.y / tl;
    f.signedSplit[i] = ((c.pos.x - pivot.x) * splitDx + (c.pos.y - pivot.y) * splitDy) / maxDist;
  }
  return f;
}

export function fieldCellsFromMap(
  fixtureId: string,
  map: { cells: MappedCell[] },
  runs: Run[],
  z: number,
): FieldCell[] {
  const runById: Record<string, Run> = {};
  for (const r of runs) runById[r.id] = r;
  return map.cells.map((c) => {
    const p = c.positions[0];
    if (!p) {
      return {
        fixtureId, physicalIndex: c.physicalIndex, logicalIndex: c.logicalIndex,
        pos: { x: 0, y: 0, z }, extentStart: { x: 0, y: 0, z }, extentEnd: { x: 0, y: 0, z },
        runId: null, arcM: 0, chain: c.physicalIndex,
      };
    }
    const run = runById[p.run] ?? runs[0];
    if (!run) {
      return {
        fixtureId, physicalIndex: c.physicalIndex, logicalIndex: c.logicalIndex,
        pos: { x: 0, y: 0, z }, extentStart: { x: 0, y: 0, z }, extentEnd: { x: 0, y: 0, z },
        runId: null, arcM: 0, chain: c.physicalIndex,
      };
    }
    const midM = (p.startM + p.endM) / 2;
    const pt = runPointAt(run, midM).p;
    return {
      fixtureId,
      physicalIndex: c.physicalIndex,
      logicalIndex: c.logicalIndex,
      pos: { x: pt.x, y: pt.y, z: pt.z },
      extentStart: runPointAt(run, p.startM).p,
      extentEnd: runPointAt(run, p.endM).p,
      runId: run.id,
      arcM: midM,
      chain: c.physicalIndex,
    };
  });
}

export function pointCells(fixtureId: string, positions: { x: number; y: number; z: number }[]): FieldCell[] {
  return positions.map((p, i) => ({
    fixtureId,
    physicalIndex: i,
    logicalIndex: i,
    pos: { ...p },
    extentStart: { ...p },
    extentEnd: { ...p },
    runId: null,
    arcM: 0,
    chain: i,
  }));
}

export function zeroSFor(room: Room, outline: Point2[], mode: string): number {
  const o = outline.length >= 3 ? outline : room.outline;
  if (mode === "front-center") {
    let best = 0;
    let bestY = -Infinity;
    for (let k = 0; k < 64; k++) {
      const p = outlinePoint(o, k / 64);
      if (p.y > bestY) { bestY = p.y; best = k / 64; }
    }
    return best;
  }
  if (mode === "controller" || mode === "custom-anchor") return room.logicalZeroS ?? 0;
  return projectToOutline(room.anchors.dj.position, o).s;
}
