// Renderer-local read shapes for spatial sampler params.
// Mirror of the show-planner primitive registry (T-PLAN-04), which stays the
// authority: it validates params and rejects unknown types. The renderer only
// samples by canonical name, so these shapes declare the fields each sampler
// reads and nothing more. If the registry adds a field, the sampler ignores
// it until it reads it here.

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
