import type { VenueFields } from "./fields.js";
import { SIDE_LEFT, SIDE_RIGHT } from "./fields.js";

export interface RoleGroups {
  PRIMARY: string[];
  SECONDARY: string[];
  ACCENT: string[];
  AMBIENT: string[];
}

export interface DerivedGroups {
  ALL: string[];
  LEFT: string[];
  RIGHT: string[];
  CENTER: string[];
  FRONT: string[];
  BACK: string[];
  CEILING: string[];
  FLOOR: string[];
  VERTICALS: string[];
  HORIZONTALS: string[];
  PERIMETER: string[];
  CORNERS: string[];
  NEAR_DJ: string[];
  byWall: Record<string, string[]>;
}

export interface SplitDef {
  id: string;
  kind: "halves" | "quadrants" | "sectors" | "walls" | "alternate" | "rings" | "drawn";
  angleRad?: number;
  sectors?: number;
  offset?: number;
  k?: number;
  rings?: number;
  anchorId?: string | null;
  line?: { a: { x: number; y: number }; b: { x: number; y: number } };
  parts?: string[][];
  featherM?: number;
}

export interface ZoneDef {
  id: string;
  name: string;
  polygon: { x: number; y: number }[];
  featherM?: number;
}

function keyOf(fields: VenueFields, i: number): string {
  return fields.keys[i]!;
}

export function derivedGroups(
  fields: VenueFields,
  opts: { nearDjM?: number; cornerM?: number; ceilingZ?: number; wallNames?: string[] } = {},
): DerivedGroups {
  const ALL = fields.keys.slice();
  const LEFT: string[] = [];
  const RIGHT: string[] = [];
  const CENTER: string[] = [];
  const FRONT: string[] = [];
  const BACK: string[] = [];
  const CEILING: string[] = [];
  const FLOOR: string[] = [];
  const VERTICALS: string[] = [];
  const HORIZONTALS: string[] = [];
  const PERIMETER: string[] = [];
  const CORNERS: string[] = [];
  const NEAR_DJ: string[] = [];
  const byWall: Record<string, string[]> = {};
  const cornerM = opts.cornerM ?? 0.5;
  const ceilZ = opts.ceilingZ ?? 2.2;
  const nearM = opts.nearDjM ?? 1.5;
  for (let i = 0; i < fields.count; i++) {
    const k = keyOf(fields, i);
    if (fields.side[i] === SIDE_LEFT) LEFT.push(k);
    else if (fields.side[i] === SIDE_RIGHT) RIGHT.push(k);
    else CENTER.push(k);
    if (fields.frontBack[i] === 1) FRONT.push(k);
    else BACK.push(k);
    const z = fields.pos[i * 3 + 2]!;
    if (z >= ceilZ) CEILING.push(k);
    if (z <= 0.6) FLOOR.push(k);
    const span = Math.abs(fields.extent[i * 6 + 5]! - fields.extent[i * 6 + 2]!);
    if (z >= ceilZ) {
      HORIZONTALS.push(k);
      PERIMETER.push(k);
    } else if (span > 0.5) VERTICALS.push(k);
    else HORIZONTALS.push(k);
    if (fields.corner[i]! <= cornerM) CORNERS.push(k);
    if (fields.dDj[i]! * fields.maxDist <= nearM) NEAR_DJ.push(k);
    const w = fields.wall[i]!;
    const name = opts.wallNames?.[w] ?? `wall${w}`;
    if (byWall[name] === undefined) byWall[name] = [];
    byWall[name]!.push(k);
  }
  return { ALL, LEFT, RIGHT, CENTER, FRONT, BACK, CEILING, FLOOR, VERTICALS, HORIZONTALS, PERIMETER, CORNERS, NEAR_DJ, byWall };
}

export function defaultRoles(perimeterIds: string[], lampIds: string[]): RoleGroups {
  return { PRIMARY: perimeterIds.slice(), SECONDARY: lampIds.slice(), ACCENT: [], AMBIENT: [] };
}

export function splitWeights(
  fields: VenueFields,
  split: SplitDef,
  opts: { featherM?: number; maxDist?: number } = {},
): Float32Array[] {
  const feather = split.featherM ?? opts.featherM ?? 0.25;
  const maxD = opts.maxDist ?? fields.maxDist;
  const partOf = (i: number): number => {
    switch (split.kind) {
      case "halves":
        return fields.side[i] === SIDE_LEFT ? 0 : 1;
      case "quadrants":
      case "sectors": {
        const n = split.sectors ?? 4;
        const off = split.offset ?? 0;
        const t = ((fields.theta[i]! - off) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
        return Math.min(n - 1, Math.floor((t / (Math.PI * 2)) * n));
      }
      case "alternate": {
        const k = Math.max(2, split.k ?? 2);
        return fields.logical[i]! % k;
      }
      case "rings": {
        const n = Math.max(2, split.rings ?? 2);
        const d = fields.dCenter[i]!;
        return Math.min(n - 1, Math.floor(d * n));
      }
      case "walls":
        return fields.wall[i]!;
      case "drawn": {
        if (split.parts) {
          const k = keyOf(fields, i);
          for (let p = 0; p < split.parts.length; p++) {
            if (split.parts[p]!.includes(k)) return p;
          }
          return 0;
        }
        if (split.line) {
          const { a, b } = split.line;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const len = Math.hypot(dx, dy) || 1;
          const d = ((fields.pos[i * 3]! - a.x) * -dy + (fields.pos[i * 3 + 1]! - a.y) * dx) / len;
          return d >= 0 ? 0 : 1;
        }
        return 0;
      }
    }
  };
  const parts = split.kind === "alternate" ? Math.max(2, split.k ?? 2)
    : split.kind === "rings" ? Math.max(2, split.rings ?? 2)
    : split.kind === "quadrants" || split.kind === "sectors" ? (split.sectors ?? 4)
    : split.kind === "walls" ? Math.max(1, ...Array.from({ length: fields.count }, (_, i) => fields.wall[i]!)) + 1
    : split.parts?.length ?? 2;
  const weights: Float32Array[] = Array.from({ length: parts }, () => new Float32Array(fields.count));
  for (let i = 0; i < fields.count; i++) {
    if (split.kind === "halves" || (split.kind === "drawn" && split.line)) {
      const d = split.kind === "halves"
        ? fields.signedSplit[i]! * maxD
        : signedLineDist(fields, i, split.line!);
      const f = feather <= 0 ? (d >= 0 ? 1 : 0) : Math.min(1, Math.max(0, 0.5 + d / (2 * feather)));
      weights[0]![i] = f;
      if (weights[1]) weights[1]![i] = 1 - f;
    } else {
      const p = partOf(i);
      weights[p]![i] = 1;
    }
  }
  return weights;
}

function signedLineDist(fields: VenueFields, i: number, line: { a: { x: number; y: number }; b: { x: number; y: number } }): number {
  const dx = line.b.x - line.a.x;
  const dy = line.b.y - line.a.y;
  const len = Math.hypot(dx, dy) || 1;
  return ((fields.pos[i * 3]! - line.a.x) * -dy + (fields.pos[i * 3 + 1]! - line.a.y) * dx) / len;
}

export function zoneWeights(fields: VenueFields, zone: ZoneDef): Float32Array {
  const out = new Float32Array(fields.count);
  const feather = zone.featherM ?? 0.2;
  for (let i = 0; i < fields.count; i++) {
    const x = fields.pos[i * 3]!;
    const y = fields.pos[i * 3 + 1]!;
    const inside = pointInPolygon(x, y, zone.polygon);
    const edge = distToPolygonEdge(x, y, zone.polygon);
    if (inside) out[i] = feather <= 0 ? 1 : Math.min(1, edge / feather + 0.5);
    else out[i] = feather <= 0 ? 0 : Math.max(0, 0.5 - edge / feather);
  }
  return out;
}

function pointInPolygon(x: number, y: number, poly: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function distToPolygonEdge(x: number, y: number, poly: { x: number; y: number }[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy || 1e-9;
    const t = Math.min(1, Math.max(0, ((x - a.x) * dx + (y - a.y) * dy) / l2));
    best = Math.min(best, Math.hypot(x - (a.x + dx * t), y - (a.y + dy * t)));
  }
  return best;
}

export type Selector =
  | { kind: "group"; name: string }
  | { kind: "splitPart"; split: SplitDef; part: number; threshold?: number }
  | { kind: "zone"; zone: ZoneDef; threshold?: number }
  | { kind: "fieldRange"; field: "s" | "theta" | "h" | "dCenter" | "dDj"; min: number; max: number }
  | { kind: "anchor"; anchorId: string; radiusM: number; anchorPos: { x: number; y: number }; maxDist: number };

export function resolveSelector(
  fields: VenueFields,
  sel: Selector,
  groups: DerivedGroups,
  roles: RoleGroups,
): string[] {
  switch (sel.kind) {
    case "group": {
      const g = (groups as unknown as Record<string, string[]>)[sel.name]
        ?? (roles as unknown as Record<string, string[]>)[sel.name];
      if (g) return g.slice();
      const wallKey = Object.keys(groups.byWall).find((w) => `WALL:${w}` === sel.name || w === sel.name);
      if (wallKey) return groups.byWall[wallKey]!.slice();
      return [];
    }
    case "splitPart": {
      const w = splitWeights(fields, sel.split);
      const th = sel.threshold ?? 0.5;
      const out: string[] = [];
      for (let i = 0; i < fields.count; i++) {
        if ((w[sel.part]?.[i] ?? 0) >= th) out.push(keyOf(fields, i));
      }
      return out;
    }
    case "zone": {
      const w = zoneWeights(fields, sel.zone);
      const th = sel.threshold ?? 0.5;
      const out: string[] = [];
      for (let i = 0; i < fields.count; i++) {
        if (w[i]! >= th) out.push(keyOf(fields, i));
      }
      return out;
    }
    case "fieldRange": {
      const arr = sel.field === "s" ? fields.s : sel.field === "theta" ? fields.theta : sel.field === "h" ? fields.h : sel.field === "dCenter" ? fields.dCenter : fields.dDj;
      const out: string[] = [];
      for (let i = 0; i < fields.count; i++) {
        const v = arr[i]!;
        if (v >= sel.min && v <= sel.max) out.push(keyOf(fields, i));
      }
      return out;
    }
    case "anchor": {
      const out: string[] = [];
      for (let i = 0; i < fields.count; i++) {
        const d = Math.hypot(fields.pos[i * 3]! - sel.anchorPos.x, fields.pos[i * 3 + 1]! - sel.anchorPos.y);
        if (d <= sel.radiusM) out.push(keyOf(fields, i));
      }
      return out;
    }
  }
}
