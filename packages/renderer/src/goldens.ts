import type { PrimitiveName } from "./primitive-params.js";

export interface ReferenceFrame {
  primitive: PrimitiveName;
  roomId: string;
  beat: number;
  params: Record<string, unknown>;
}

const DEFAULT_PARAMS: Record<PrimitiveName, Record<string, unknown>> = {
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

export function referenceFrames(name: PrimitiveName, roomId = "square-loop", beat = 1): ReferenceFrame {
  return { primitive: name, roomId, beat, params: DEFAULT_PARAMS[name] ?? {} };
}
