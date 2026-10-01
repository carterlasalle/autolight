export interface Point2 { x: number; y: number }
export interface Point3 { x: number; y: number; z: number }

export type Units = "m" | "ft";
export const METERS_PER_FOOT = 0.3048;

export interface Opening {
  wall: number;
  from: number;
  to: number;
  kind: "door" | "window" | "gap";
}

export interface DjAnchor { position: Point2; facingRad: number }
export interface CustomAnchor { id: string; name: string; position: Point3 }

export interface RoomAnchors {
  dj: DjAnchor;
  center: Point2 | null;
  audience: Point2 | null;
  custom: CustomAnchor[];
}

export type PerimeterZero = "dj-nearest" | "front-center" | "controller" | "custom-anchor";
export type PerimeterDirection = "clockwise" | "counterclockwise";

export interface RoomBackground {
  imageRef: string;
  scale: number;
  offset: Point2;
  rotationRad: number;
  opacity: number;
}

export interface Room {
  id: string;
  name: string;
  units: Units;
  outline: Point2[];
  ceilingHeight: number;
  wallNames: string[];
  openings: Opening[];
  anchors: RoomAnchors;
  background?: RoomBackground;
  perimeterZero?: PerimeterZero;
  perimeterDirection?: PerimeterDirection;
  pivotAnchorId?: string | null;
  logicalZeroS?: number;
}

export function toMeters(value: number, units: Units): number {
  return units === "ft" ? value * METERS_PER_FOOT : value;
}

export function fromMeters(value: number, units: Units): number {
  return units === "ft" ? value / METERS_PER_FOOT : value;
}

export function signedArea(outline: Point2[]): number {
  let sum = 0;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i]!;
    const b = outline[(i + 1) % outline.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

export function polygonArea(outline: Point2[]): number {
  return Math.abs(signedArea(outline));
}

export function isClockwiseFromAbove(outline: Point2[]): boolean {
  return signedArea(outline) < 0;
}

export function normalizeOutline(outline: Point2[]): Point2[] {
  const copy = outline.map((p) => ({ ...p }));
  if (copy.length >= 3 && !isClockwiseFromAbove(copy)) copy.reverse();
  return copy;
}

export function polygonCentroid(outline: Point2[]): Point2 {
  let cx = 0;
  let cy = 0;
  let a = 0;
  for (let i = 0; i < outline.length; i++) {
    const p = outline[i]!;
    const q = outline[(i + 1) % outline.length]!;
    const cross = p.x * q.y - q.x * p.y;
    a += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  a /= 2;
  if (Math.abs(a) < 1e-12) {
    const n = outline.length;
    let sx = 0;
    let sy = 0;
    for (const p of outline) { sx += p.x; sy += p.y; }
    return { x: sx / Math.max(1, n), y: sy / Math.max(1, n) };
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

function segmentsIntersect(a: Point2, b: Point2, c: Point2, d: Point2): boolean {
  const orient = (p: Point2, q: Point2, r: Point2): number => {
    const v = (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
    if (Math.abs(v) < 1e-12) return 0;
    return v > 0 ? 1 : 2;
  };
  const onSeg = (p: Point2, q: Point2, r: Point2): boolean =>
    q.x <= Math.max(p.x, r.x) + 1e-12 && q.x >= Math.min(p.x, r.x) - 1e-12 &&
    q.y <= Math.max(p.y, r.y) + 1e-12 && q.y >= Math.min(p.y, r.y) - 1e-12;
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSeg(a, c, b)) return true;
  if (o2 === 0 && onSeg(a, d, b)) return true;
  if (o3 === 0 && onSeg(c, a, d)) return true;
  if (o4 === 0 && onSeg(c, b, d)) return true;
  return false;
}

export function validateRoom(room: Room): string[] {
  const problems: string[] = [];
  if (!room.id) problems.push("room.id is required");
  if (!room.name) problems.push("room.name is required");
  if (room.outline.length < 3) problems.push("outline needs at least 3 corners");
  if (room.ceilingHeight <= 0) problems.push("ceilingHeight must be positive");
  if (room.wallNames.length !== 0 && room.wallNames.length !== room.outline.length) {
    problems.push(`wallNames has ${room.wallNames.length} entries for ${room.outline.length} walls`);
  }
  const area = polygonArea(room.outline);
  if (!(area > 0)) problems.push("outline area must be positive");
  const n = room.outline.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === n - 1)) continue;
      const a = room.outline[i]!;
      const b = room.outline[(i + 1) % n]!;
      const c = room.outline[j]!;
      const d = room.outline[(j + 1) % n]!;
      if (segmentsIntersect(a, b, c, d)) {
        problems.push(`outline self-intersects: edge ${i} crosses edge ${j}`);
      }
    }
  }
  for (const o of room.openings) {
    if (o.wall < 0 || o.wall >= n) problems.push(`opening wall ${o.wall} out of range`);
    if (!(o.from >= 0 && o.to <= 1 && o.from < o.to)) problems.push("opening from/to must satisfy 0 <= from < to <= 1");
  }
  return problems;
}

export function roomCenter(room: Room): Point2 {
  return room.anchors.center ?? polygonCentroid(normalizeOutline(room.outline));
}

export function wallLengths(outline: Point2[]): number[] {
  return outline.map((p, i) => {
    const q = outline[(i + 1) % outline.length]!;
    return Math.hypot(q.x - p.x, q.y - p.y);
  });
}

export function perimeterLength(outline: Point2[]): number {
  return wallLengths(outline).reduce((a, b) => a + b, 0);
}

export function rectangleRoom(widthM: number, lengthM: number, name = "Square room"): Room {
  const w = widthM / 2;
  const l = lengthM / 2;
  const outline: Point2[] = [
    { x: -w, y: -l },
    { x: -w, y: l },
    { x: w, y: l },
    { x: w, y: -l },
  ];
  return {
    id: "room-square",
    name,
    units: "m",
    outline: normalizeOutline(outline),
    ceilingHeight: 2.6,
    wallNames: ["Front", "Right", "Back", "Left"],
    openings: [],
    anchors: {
      dj: { position: { x: 0, y: -l + 0.5 }, facingRad: 0 },
      center: null,
      audience: { x: 0, y: 0.5 },
      custom: [],
    },
    perimeterZero: "dj-nearest",
    perimeterDirection: "clockwise",
    pivotAnchorId: null,
    logicalZeroS: 0,
  };
}

export type SplineKind = "polyline" | "catmull-rom" | "cubic-bezier";

export interface SplineGeom {
  kind: Exclude<SplineKind, "polyline">;
  tension?: number;
}

function catmullPoint(p0: Point3, p1: Point3, p2: Point3, p3: Point3, t: number): Point3 {
  const t2 = t * t;
  const t3 = t2 * t;
  const mix = (a: number, b: number, c: number, d: number): number =>
    0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return { x: mix(p0.x, p1.x, p2.x, p3.x), y: mix(p0.y, p1.y, p2.y, p3.y), z: mix(p0.z, p1.z, p2.z, p3.z) };
}

export function samplePath(points: Point3[], geom: SplineGeom | undefined, toleranceM: number, closed = false): Point3[] {
  if (!geom || geom.kind === undefined || points.length < 3) return points.map((p) => ({ ...p }));
  const ring = closed ? [...points, points[0]!] : points;
  const out: Point3[] = [];
  const segs = ring.length - 1;
  const steps = Math.max(4, Math.min(64, Math.ceil(0.05 / Math.max(1e-6, toleranceM))));
  for (let i = 0; i < segs; i++) {
    const p0 = ring[(i - 1 + ring.length) % ring.length]!;
    const p1 = ring[i]!;
    const p2 = ring[i + 1]!;
    const p3 = ring[(i + 2) % ring.length]!;
    for (let k = 0; k < steps; k++) {
      out.push(catmullPoint(p0, p1, p2, p3, k / steps));
    }
  }
  out.push({ ...(closed ? ring[0]! : points[points.length - 1]!) });
  return out;
}

export function polylineLength(points: Point3[], geom?: SplineGeom, toleranceM = 0.005, closed = false): number {
  const sampled = samplePath(points, geom, toleranceM, closed);
  let len = 0;
  for (let i = 0; i + 1 < sampled.length; i++) {
    const a = sampled[i]!;
    const b = sampled[i + 1]!;
    len += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }
  return len;
}

export const MARKER_KINDS = ["seam", "logical-zero", "dj", "center", "audience", "custom"] as const;
export type MarkerKind = (typeof MARKER_KINDS)[number];
