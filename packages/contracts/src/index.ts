import { z } from "zod";

export const deckSourceSchema = z.enum(["rekordbox", "serato"]);
export type DeckSource = z.infer<typeof deckSourceSchema>;

export const loopStateSchema = z.object({
  active: z.boolean(),
  startSeconds: z.number().nullable(),
  endSeconds: z.number().nullable(),
  beatLength: z.number().nullable(),
});
export type LoopState = z.infer<typeof loopStateSchema>;

export const trackIdentitySchema = z.object({
  id: z.string().min(1),
  sourceIds: z.object({
    rekordboxId: z.string().optional(),
    seratoPath: z.string().optional(),
  }),
  canonicalPath: z.string().optional(),
  title: z.string().optional(),
  artist: z.string().optional(),
  fileHash: z.string().optional(),
  pcmFingerprint: z.string().optional(),
});
export type TrackIdentity = z.infer<typeof trackIdentitySchema>;

export const deckStateSchema = z.object({
  source: deckSourceSchema,
  deckId: z.number().int(),
  track: trackIdentitySchema.nullable(),
  playing: z.boolean(),
  playheadSeconds: z.number(),
  playRate: z.number(),
  effectiveBpm: z.number().nullable(),
  loop: loopStateSchema,
  channelFader: z.number().min(0).max(1).nullable(),
  crossfader: z.number().min(0).max(1).nullable(),
  master: z.boolean().nullable(),
  receivedAtNs: z.bigint(),
});
export type DeckState = z.infer<typeof deckStateSchema>;

export const nativeBeatSchema = z.object({
  index: z.number().int().nonnegative(),
  beatInBar: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  sourceTimeMs: z.number().nonnegative(),
  bpm: z.number().positive(),
});
export type NativeBeat = z.infer<typeof nativeBeatSchema>;

export const beatGridSchema = z.object({
  beats: z.array(nativeBeatSchema).min(1),
  version: z.number().int().default(1),
});
export type BeatGrid = z.infer<typeof beatGridSchema>;

// Binary search over native grid anchors, piecewise interpolation (§74).
export function sourceSecondsToBeat(grid: BeatGrid, seconds: number): number {
  const b = grid.beats;
  const ms = seconds * 1000;
  if (ms <= b[0]!.sourceTimeMs) return b[0]!.index;
  let lo = 0;
  let hi = b.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (b[mid]!.sourceTimeMs <= ms) lo = mid;
    else hi = mid;
  }
  const a = b[lo]!;
  const c = b[hi]!;
  const span = c.sourceTimeMs - a.sourceTimeMs;
  if (span <= 0) return a.index;
  return a.index + (ms - a.sourceTimeMs) / span;
}

export function beatToSourceSeconds(grid: BeatGrid, beat: number): number {
  const b = grid.beats;
  const clamped = Math.min(Math.max(beat, b[0]!.index), b[b.length - 1]!.index);
  const i = Math.floor(clamped);
  const frac = clamped - i;
  // ponytail: linear index lookup, binary search if grids grow large
  const a = b.find((x) => x.index === i) ?? b[0]!;
  const c = b.find((x) => x.index === i + 1) ?? a;
  return (a.sourceTimeMs + (c.sourceTimeMs - a.sourceTimeMs) * frac) / 1000;
}

export const sectionKindSchema = z.enum([
  "intro",
  "verse",
  "prechorus",
  "build",
  "drop",
  "chorus",
  "breakdown",
  "bridge",
  "instrumental",
  "solo",
  "outro",
  "transition",
  "unknown",
]);
export type SectionKind = z.infer<typeof sectionKindSchema>;

export const musicalEventTypeSchema = z.enum([
  "build-start",
  "build-intensification",
  "predrop",
  "drop",
  "fake-drop",
  "breakdown",
  "fill",
  "silence",
  "vocal-entry",
  "vocal-exit",
  "final-hit",
  "outro-release",
  "section-transition",
]);
export type MusicalEventType = z.infer<typeof musicalEventTypeSchema>;

export const trackModelSchema = z.object({
  schemaVersion: z.literal(1),
  analyzerVersion: z.string(),
  identity: trackIdentitySchema,
  durationSeconds: z.number().nonnegative(),
  beatGrid: beatGridSchema,
  sections: z.array(
    z.object({
      kind: sectionKindSchema,
      rawLabel: z.string().optional(),
      startBeat: z.number(),
      endBeat: z.number(),
      confidence: z.number().min(0).max(1),
    }),
  ),
  musicalEvents: z.array(
    z.object({
      type: musicalEventTypeSchema,
      beat: z.number(),
      endBeat: z.number().optional(),
      confidence: z.number().min(0).max(1),
      strength: z.number().min(0).max(1).optional(),
    }),
  ),
  analysisCoverage: z.enum(["full", "structured", "adaptive"]),
});
export type TrackModel = z.infer<typeof trackModelSchema>;

export const showStyleSchema = z.object({
  id: z.string(),
  intensityRange: z.tuple([z.number(), z.number()]),
  darknessPreference: z.number().min(0).max(1),
  reactiveAmount: z.number().min(0).max(1),
  whiteHitFrequency: z.number().min(0).max(1),
  strobeFrequency: z.number().min(0).max(1),
});
export type ShowStyle = z.infer<typeof showStyleSchema>;

export const showCueSchema = z.object({
  type: z.string().min(1),
  startBeat: z.number(),
  durationBeats: z.number().nonnegative(),
  intensity: z.number().min(0).max(1),
  target: z.string().min(1),
  priority: z.number(),
});
export type ShowCue = z.infer<typeof showCueSchema>;

export const showPlanSchema = z.object({
  schemaVersion: z.literal(1),
  plannerVersion: z.string(),
  trackId: z.string(),
  styleId: z.string(),
  seed: z.string(),
  cues: z.array(showCueSchema),
});
export type ShowPlan = z.infer<typeof showPlanSchema>;

export const fixtureCellSchema = z.object({
  index: z.number().int().nonnegative(),
  position: z.object({ x: z.number(), y: z.number(), z: z.number().optional() }),
  order: z.number().int(),
  tags: z.array(z.string()),
});
export type FixtureCell = z.infer<typeof fixtureCellSchema>;

export const fixtureCalibrationSchema = z.object({
  segmentCount: z.number().int().positive(),
  maxStableFps: z.number().positive(),
  expectedLatencyMs: z.number().nonnegative(),
  armSettleMs: z.number().nonnegative(),
  orientation: z.enum(["forward", "reverse"]),
  gamma: z.number().positive(),
  brightnessCeiling: z.number().min(0).max(1),
  firmwareVersion: z.string(),
});
export type FixtureCalibration = z.infer<typeof fixtureCalibrationSchema>;

export const fixtureSchema = z.object({
  id: z.string().min(1),
  adapter: z.literal("govee"),
  sku: z.string(),
  hardwareId: z.string(),
  cells: z.array(fixtureCellSchema),
  calibration: fixtureCalibrationSchema.nullable(),
});
export type Fixture = z.infer<typeof fixtureSchema>;

export interface DJLiveProvider {
  readonly id: string;
  readonly source: DeckSource;
  start(): Promise<void>;
  stop(): Promise<void>;
  getDecks(): readonly DeckState[];
  onDeckState(listener: (state: DeckState) => void): () => void;
  onConnection(listener: (up: boolean) => void): () => void;
}
