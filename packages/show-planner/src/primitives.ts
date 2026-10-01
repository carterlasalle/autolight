export type SpatialCoordinate = "uv" | "s" | "theta" | "h" | "distance" | "split" | "chain";

export interface PrimitiveMeta {
  name: string;
  coordinate: SpatialCoordinate;
  energy: "low" | "mid" | "high";
  sections: string[];
  restraintCost: number;
  needsClosedOrIndependent: boolean;
  needsFixtureRateHz: number | null;
}

export interface PrimitiveParams {
  Orbit: { heads: number; direction: "clockwise" | "counterclockwise"; beatsPerRevolution: number; tailCells: number; tailCurve: "linear" | "exp"; phase: number; includeProjected: boolean };
  PerimeterOrbit: { heads: number; direction: "clockwise" | "counterclockwise"; beatsPerRevolution: number; tailCells: number; path: "shortest" | "directed" | "auto"; includeProjected: boolean };
  Ripple: { originS: number; metric: "geodesic" | "euclidean"; roomFractionPerBeat: number; width: number; decay: number; count: number };
  RadialPulse: { originS: number; roomFractionPerBeat: number; width: number; decay: number; count: number };
  OpposedPulse: { originS: number; meetBeat: number; width: number; passThrough: boolean };
  Converge: { originS: number; meetBeat: number; tailCells: number };
  Diverge: { originS: number; meetBeat: number; tailCells: number };
  Radar: { beatsPerRevolution: number; widthRad: number; direction: "clockwise" | "counterclockwise" };
  SplitAlternate: { splitId: string; rateBeats: number; duty: number; strobe: boolean };
  QuadrantRotate: { stepBeats: number; direction: "forward" | "reverse"; sectors: number };
  WallStep: { stepBeats: number };
  CornerHits: { decayBeats: number };
  Fill: { originS: number; bothWays: boolean; progress: number };
  Unfill: { originS: number; bothWays: boolean; progress: number };
  GradientRotate: { speedRevPerBeat: number };
  Spiral: { turns: number; speedRevPerBeat: number };
  Breathe: { periodBeats: number; depth: number };
  Mirror: { axis: string; inner: string };
  SymmetricSweep: { beatsPerSweep: number };
  SpatialWipe: { angleRad: number; edge: number; wipeOn: boolean };
  GroupHandoff: { from: string; to: string; handoffBeat: number; overlapBeats: number };
  TextureHold: { field: "s" | "uv"; scale: number; speed: number; depth: number; seed: number };
  FinalHit: { decayBeats: number };
  StaticLook: { level: number };
  GradientLook: { speedRevPerBeat: number };
  Pulse: { widthBeats: number };
  Bump: { widthBeats: number };
  DecayHit: { decayBeats: number };
  Alternate: { rateBeats: number };
  Chase: { heads: number; beatsPerCycle: number };
  Sweep: { beatsPerSweep: number };
  MirrorSweep: { beatsPerSweep: number };
  OutsideIn: { width: number };
  InsideOut: { width: number };
  Split: { splitId: string };
  Wave: { beatsPerCycle: number };
  BuildRamp: { from: number };
  PhraseTurn: { turnBeats: number };
  FillAccent: { progress: number };
  Impact: { decayBeats: number };
  WhiteHit: { level: number };
  Blackout: { [key: string]: never };
  Dip: { remain: number };
  Reveal: { progress: number };
  StrobeBurst: { rateHz: number; duty: number; durationBeats: number };
  RollPattern: { division: number };
  DropPattern: { stages: number };
  BreakdownLook: { level: number };
  VocalFocus: { level: number };
  OutroRelease: { decayBeats: number };
}
export type PrimitiveName = keyof PrimitiveParams;

export const PRIMITIVE_DEFAULTS: { [K in PrimitiveName]: PrimitiveParams[K] } = {
  Orbit: { heads: 1, direction: "clockwise", beatsPerRevolution: 4, tailCells: 3, tailCurve: "exp", phase: 0, includeProjected: false },
  PerimeterOrbit: { heads: 1, direction: "clockwise", beatsPerRevolution: 4, tailCells: 3, path: "auto", includeProjected: false },
  Ripple: { originS: 0, metric: "geodesic", roomFractionPerBeat: 0.25, width: 0.08, decay: 0.5, count: 1 },
  RadialPulse: { originS: 0, roomFractionPerBeat: 0.25, width: 0.08, decay: 0.5, count: 1 },
  OpposedPulse: { originS: 0, meetBeat: 4, width: 0.08, passThrough: false },
  Converge: { originS: 0, meetBeat: 4, tailCells: 3 },
  Diverge: { originS: 0, meetBeat: 4, tailCells: 3 },
  Radar: { beatsPerRevolution: 4, widthRad: 0.6, direction: "clockwise" },
  SplitAlternate: { splitId: "halves", rateBeats: 0.5, duty: 0.5, strobe: false },
  QuadrantRotate: { stepBeats: 1, direction: "forward", sectors: 4 },
  WallStep: { stepBeats: 1 },
  CornerHits: { decayBeats: 1 },
  Fill: { originS: 0, bothWays: true, progress: 0.5 },
  Unfill: { originS: 0, bothWays: true, progress: 0.5 },
  GradientRotate: { speedRevPerBeat: 0.05 },
  Spiral: { turns: 2, speedRevPerBeat: 0.1 },
  Breathe: { periodBeats: 4, depth: 0.5 },
  Mirror: { axis: "dj", inner: "Orbit" },
  SymmetricSweep: { beatsPerSweep: 4 },
  SpatialWipe: { angleRad: 0, edge: 0.1, wipeOn: true },
  GroupHandoff: { from: "SECONDARY", to: "PRIMARY", handoffBeat: 4, overlapBeats: 1 },
  TextureHold: { field: "s", scale: 3, speed: 0.05, depth: 0.3, seed: 7 },
  FinalHit: { decayBeats: 4 },
  StaticLook: { level: 1 },
  GradientLook: { speedRevPerBeat: 0.02 },
  Pulse: { widthBeats: 0.5 },
  Bump: { widthBeats: 0.25 },
  DecayHit: { decayBeats: 1 },
  Alternate: { rateBeats: 1 },
  Chase: { heads: 1, beatsPerCycle: 2 },
  Sweep: { beatsPerSweep: 2 },
  MirrorSweep: { beatsPerSweep: 2 },
  OutsideIn: { width: 0.1 },
  InsideOut: { width: 0.1 },
  Split: { splitId: "halves" },
  Wave: { beatsPerCycle: 2 },
  BuildRamp: { from: 0.2 },
  PhraseTurn: { turnBeats: 4 },
  FillAccent: { progress: 0.5 },
  Impact: { decayBeats: 0.5 },
  WhiteHit: { level: 1 },
  Blackout: {},
  Dip: { remain: 0.3 },
  Reveal: { progress: 0.5 },
  StrobeBurst: { rateHz: 8, duty: 0.08, durationBeats: 1 },
  RollPattern: { division: 8 },
  DropPattern: { stages: 4 },
  BreakdownLook: { level: 0.3 },
  VocalFocus: { level: 0.7 },
  OutroRelease: { decayBeats: 8 },
};

interface NumSpec { min?: number; max?: number; int?: boolean; positive?: boolean }
type FieldSpec = NumSpec | { options: readonly string[] };

const PARAM_SPECS: Record<PrimitiveName, Record<string, FieldSpec>> = {
  Orbit: { heads: { min: 1, max: 8, int: true }, beatsPerRevolution: { positive: true }, tailCells: { min: 0 }, direction: { options: ["clockwise", "counterclockwise"] }, tailCurve: { options: ["linear", "exp"] } },
  PerimeterOrbit: { heads: { min: 1, max: 8, int: true }, beatsPerRevolution: { positive: true }, tailCells: { min: 0 }, direction: { options: ["clockwise", "counterclockwise"] }, path: { options: ["shortest", "directed", "auto"] } },
  Ripple: { originS: { min: 0, max: 1 }, metric: { options: ["geodesic", "euclidean"] }, roomFractionPerBeat: { positive: true }, width: { positive: true }, decay: { min: 0, max: 1 }, count: { min: 1, max: 4, int: true } },
  RadialPulse: { originS: { min: 0, max: 1 }, roomFractionPerBeat: { positive: true }, width: { positive: true }, decay: { min: 0, max: 1 }, count: { min: 1, max: 4, int: true } },
  OpposedPulse: { originS: { min: 0, max: 1 }, meetBeat: { min: 0 }, width: { positive: true } },
  Converge: { originS: { min: 0, max: 1 }, meetBeat: { positive: true }, tailCells: { min: 0 } },
  Diverge: { originS: { min: 0, max: 1 }, meetBeat: { positive: true }, tailCells: { min: 0 } },
  Radar: { beatsPerRevolution: { positive: true }, widthRad: { positive: true }, direction: { options: ["clockwise", "counterclockwise"] } },
  SplitAlternate: { rateBeats: { positive: true }, duty: { min: 0, max: 1 } },
  QuadrantRotate: { stepBeats: { positive: true }, direction: { options: ["forward", "reverse"] }, sectors: { min: 2, max: 16, int: true } },
  WallStep: { stepBeats: { positive: true } },
  CornerHits: { decayBeats: { positive: true } },
  Fill: { originS: { min: 0, max: 1 }, progress: { min: 0, max: 1 } },
  Unfill: { originS: { min: 0, max: 1 }, progress: { min: 0, max: 1 } },
  GradientRotate: {},
  Spiral: { turns: { positive: true } },
  Breathe: { periodBeats: { positive: true }, depth: { min: 0, max: 1 } },
  Mirror: {},
  SymmetricSweep: { beatsPerSweep: { positive: true } },
  SpatialWipe: { edge: { positive: true } },
  GroupHandoff: { handoffBeat: { min: 0 }, overlapBeats: { min: 0 } },
  TextureHold: { field: { options: ["s", "uv"] }, scale: { positive: true }, depth: { min: 0, max: 1 }, seed: { int: true } },
  FinalHit: { decayBeats: { positive: true } },
  StaticLook: { level: { min: 0, max: 1 } },
  GradientLook: {},
  Pulse: { widthBeats: { positive: true } },
  Bump: { widthBeats: { positive: true } },
  DecayHit: { decayBeats: { positive: true } },
  Alternate: { rateBeats: { positive: true } },
  Chase: { heads: { min: 1, max: 8, int: true }, beatsPerCycle: { positive: true } },
  Sweep: { beatsPerSweep: { positive: true } },
  MirrorSweep: { beatsPerSweep: { positive: true } },
  OutsideIn: { width: { positive: true } },
  InsideOut: { width: { positive: true } },
  Split: {},
  Wave: { beatsPerCycle: { positive: true } },
  BuildRamp: { from: { min: 0, max: 1 } },
  PhraseTurn: { turnBeats: { positive: true } },
  FillAccent: { progress: { min: 0, max: 1 } },
  Impact: { decayBeats: { positive: true } },
  WhiteHit: { level: { min: 0, max: 1 } },
  Blackout: {},
  Dip: { remain: { min: 0, max: 1 } },
  Reveal: { progress: { min: 0, max: 1 } },
  StrobeBurst: { rateHz: { positive: true }, duty: { min: 0, max: 1 }, durationBeats: { positive: true } },
  RollPattern: { division: { min: 2, max: 16, int: true } },
  DropPattern: { stages: { min: 1, max: 8, int: true } },
  BreakdownLook: { level: { min: 0, max: 1 } },
  VocalFocus: { level: { min: 0, max: 1 } },
  OutroRelease: { decayBeats: { positive: true } },
};

export function parsePrimitiveParams<T extends PrimitiveName>(name: T, params: unknown): PrimitiveParams[T] {
  const defaults = PRIMITIVE_DEFAULTS[name] as Record<string, unknown>;
  const input = (params ?? {}) as Record<string, unknown>;
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error(`invalid params for ${name}: expected an object`);
  }
  const specs = PARAM_SPECS[name] ?? {};
  const out: Record<string, unknown> = { ...defaults };
  for (const [key, value] of Object.entries(input)) {
    if (!(key in defaults)) throw new Error(`unknown param ${key} for ${name}`);
    const spec = specs[key];
    const def = defaults[key];
    if (spec !== undefined && "options" in spec) {
      if (typeof value !== "string" || !spec.options.includes(value)) {
        throw new Error(`invalid ${name}.${key}: expected one of ${spec.options.join("|")}`);
      }
    } else if (typeof def === "number") {
      if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`invalid ${name}.${key}: expected a number`);
      const s = spec as NumSpec | undefined;
      if (s?.int === true && !Number.isInteger(value)) throw new Error(`invalid ${name}.${key}: expected an integer`);
      if (s?.positive === true && !(value > 0)) throw new Error(`invalid ${name}.${key}: expected positive`);
      if (s?.min !== undefined && value < s.min) throw new Error(`invalid ${name}.${key}: below minimum ${s.min}`);
      if (s?.max !== undefined && value > s.max) throw new Error(`invalid ${name}.${key}: above maximum ${s.max}`);
    } else if (typeof def === "boolean") {
      if (typeof value !== "boolean") throw new Error(`invalid ${name}.${key}: expected a boolean`);
    } else if (typeof def === "string") {
      if (typeof value !== "string" || value.length < 1) throw new Error(`invalid ${name}.${key}: expected a non-empty string`);
    }
    out[key] = value;
  }
  return out as PrimitiveParams[T];
}

export const SPATIAL_PRIMITIVES: PrimitiveName[] = [
  "Orbit", "PerimeterOrbit", "Ripple", "RadialPulse", "OpposedPulse", "Converge", "Diverge",
  "Radar", "SplitAlternate", "QuadrantRotate", "WallStep", "CornerHits", "Fill", "Unfill",
  "GradientRotate", "Spiral", "Breathe", "Mirror", "SymmetricSweep", "SpatialWipe",
  "GroupHandoff", "TextureHold", "FinalHit",
];

export const SPEC_PRIMITIVES: PrimitiveName[] = [
  "StaticLook", "GradientLook", "Pulse", "Bump", "DecayHit", "Alternate", "Chase", "Sweep",
  "MirrorSweep", "OutsideIn", "InsideOut", "Split", "Wave", "BuildRamp", "PhraseTurn",
  "FillAccent", "Impact", "WhiteHit", "Blackout", "Dip", "Reveal", "StrobeBurst",
  "RollPattern", "DropPattern", "BreakdownLook", "VocalFocus", "OutroRelease",
];

export const MOVEMENT_VOCABULARY = [
  "rise", "fall", "cross", "fan", "converge", "diverge", "chase",
  "outside-in", "inside-out", "vertical-scan", "rotation",
] as const;

const COORD: Record<PrimitiveName, SpatialCoordinate> = {
  Orbit: "s", PerimeterOrbit: "s", Ripple: "distance", RadialPulse: "distance",
  OpposedPulse: "distance", Converge: "s", Diverge: "s", Radar: "theta",
  SplitAlternate: "split", QuadrantRotate: "split", WallStep: "s", CornerHits: "distance",
  Fill: "s", Unfill: "s", GradientRotate: "s", Spiral: "h", Breathe: "distance",
  Mirror: "uv", SymmetricSweep: "s", SpatialWipe: "uv", GroupHandoff: "split",
  TextureHold: "s", FinalHit: "distance",
  StaticLook: "uv", GradientLook: "uv", Pulse: "distance", Bump: "distance",
  DecayHit: "distance", Alternate: "split", Chase: "chain", Sweep: "uv",
  MirrorSweep: "uv", OutsideIn: "distance", InsideOut: "distance", Split: "split",
  Wave: "chain", BuildRamp: "distance", PhraseTurn: "theta", FillAccent: "s",
  Impact: "distance", WhiteHit: "uv", Blackout: "uv", Dip: "uv", Reveal: "uv",
  StrobeBurst: "uv", RollPattern: "chain", DropPattern: "distance",
  BreakdownLook: "uv", VocalFocus: "distance", OutroRelease: "distance",
};

const ENERGY: Record<PrimitiveName, PrimitiveMeta["energy"]> = {
  Orbit: "mid", PerimeterOrbit: "mid", Ripple: "high", RadialPulse: "high",
  OpposedPulse: "high", Converge: "mid", Diverge: "mid", Radar: "mid",
  SplitAlternate: "high", QuadrantRotate: "mid", WallStep: "mid", CornerHits: "mid",
  Fill: "mid", Unfill: "low", GradientRotate: "low", Spiral: "mid", Breathe: "low",
  Mirror: "mid", SymmetricSweep: "mid", SpatialWipe: "mid", GroupHandoff: "mid",
  TextureHold: "low", FinalHit: "high",
  StaticLook: "low", GradientLook: "low", Pulse: "mid", Bump: "mid",
  DecayHit: "high", Alternate: "mid", Chase: "mid", Sweep: "mid",
  MirrorSweep: "mid", OutsideIn: "mid", InsideOut: "mid", Split: "mid",
  Wave: "mid", BuildRamp: "mid", PhraseTurn: "mid", FillAccent: "mid",
  Impact: "high", WhiteHit: "high", Blackout: "low", Dip: "low", Reveal: "mid",
  StrobeBurst: "high", RollPattern: "mid", DropPattern: "high",
  BreakdownLook: "low", VocalFocus: "low", OutroRelease: "low",
};

const SUITABLE: Record<PrimitiveName, string[]> = {
  Orbit: ["chorus", "drop", "instrumental"], PerimeterOrbit: ["chorus", "drop"],
  Ripple: ["drop", "chorus"], RadialPulse: ["drop", "chorus"], OpposedPulse: ["drop"],
  Converge: ["build", "prechorus"], Diverge: ["drop", "chorus"], Radar: ["verse", "instrumental"],
  SplitAlternate: ["drop", "chorus"], QuadrantRotate: ["verse", "chorus"], WallStep: ["verse"],
  CornerHits: ["chorus"], Fill: ["build", "prechorus"], Unfill: ["outro"],
  GradientRotate: ["breakdown", "intro"], Spiral: ["bridge", "instrumental"], Breathe: ["breakdown", "intro"],
  Mirror: ["chorus"], SymmetricSweep: ["chorus", "verse"], SpatialWipe: ["transition", "verse"],
  GroupHandoff: ["transition"], TextureHold: ["breakdown", "intro"], FinalHit: ["outro"],
  StaticLook: ["intro", "verse"], GradientLook: ["intro", "breakdown"], Pulse: ["verse"],
  Bump: ["chorus"], DecayHit: ["drop"], Alternate: ["chorus"], Chase: ["chorus"],
  Sweep: ["verse"], MirrorSweep: ["chorus"], OutsideIn: ["build"], InsideOut: ["drop"],
  Split: ["chorus"], Wave: ["verse"], BuildRamp: ["build", "prechorus"], PhraseTurn: ["transition"],
  FillAccent: ["build"], Impact: ["drop"], WhiteHit: ["drop"], Blackout: ["transition"],
  Dip: ["verse"], Reveal: ["intro"], StrobeBurst: ["drop"], RollPattern: ["build"],
  DropPattern: ["drop"], BreakdownLook: ["breakdown"], VocalFocus: ["verse"], OutroRelease: ["outro"],
};

export const PRIMITIVE_REGISTRY: Record<PrimitiveName, PrimitiveMeta> = Object.fromEntries(
  (Object.keys(COORD) as PrimitiveName[]).map((name) => [
    name,
    {
      name,
      coordinate: COORD[name],
      energy: ENERGY[name],
      sections: SUITABLE[name] ?? ["verse"],
      restraintCost: name === "StrobeBurst" || name === "SplitAlternate" ? 2 : name === "WhiteHit" || name === "Impact" ? 3 : 1,
      needsClosedOrIndependent: name === "Orbit" || name === "PerimeterOrbit",
      needsFixtureRateHz: name === "StrobeBurst" || name === "SplitAlternate" ? 24 : null,
    } satisfies PrimitiveMeta,
  ]),
) as Record<PrimitiveName, PrimitiveMeta>;

export function isPrimitiveName(value: string): value is PrimitiveName {
  return value in PRIMITIVE_REGISTRY;
}

function kebab(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

const ALIAS_TO_CANONICAL: Record<string, PrimitiveName> = Object.fromEntries([
  ...((Object.keys(COORD) as PrimitiveName[]).map((name) => [kebab(name), name] as const)),
  ["section-look", "StaticLook"],
  ["chase-flip", "Chase"],
]) as Record<string, PrimitiveName>;

export function resolvePrimitiveName(value: string): PrimitiveName | null {
  if (value in PRIMITIVE_REGISTRY) return value as PrimitiveName;
  return ALIAS_TO_CANONICAL[value] ?? null;
}

export function isKnownCueType(value: string): boolean {
  return resolvePrimitiveName(value) !== null;
}

export class UnknownPrimitiveError extends Error {
  readonly code = "unknown-primitive";
  constructor(readonly primitiveType: string) {
    super(`unknown primitive type: ${primitiveType}`);
  }
}

export function requirePrimitive(name: string): PrimitiveMeta {
  const canonical = resolvePrimitiveName(name);
  if (!canonical) throw new UnknownPrimitiveError(name);
  return PRIMITIVE_REGISTRY[canonical]!;
}

export function checkTopology(name: PrimitiveName, topology: string): string | null {
  const meta = PRIMITIVE_REGISTRY[name]!;
  if (meta.needsClosedOrIndependent && (topology === "split-mirrored" || topology === "point" || topology === "vertical-line")) {
    return `${name} needs a closed loop or independent split; ${topology} cannot carry a true orbit`;
  }
  return null;
}

export function checkFixtureRate(name: PrimitiveName, rateHz: number | null): string | null {
  const meta = PRIMITIVE_REGISTRY[name]!;
  if (meta.needsFixtureRateHz !== null && rateHz !== null && rateHz < meta.needsFixtureRateHz) {
    return `${name} needs fixture rate at least ${meta.needsFixtureRateHz} Hz, have ${rateHz}`;
  }
  return null;
}
