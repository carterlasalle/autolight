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

export const adaptiveBeatGridSchema = z.object({
  beats: z.array(nativeBeatSchema).max(0),
  version: z.number().int().default(1),
}).strict();
export type AdaptiveBeatGrid = z.infer<typeof adaptiveBeatGridSchema>;

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
  // Linear index lookup; switch to binary search if grids grow large (T-RBL-03).
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
  "major-section-transition",
  "minor-phrase-transition",
  "build-start",
  "build-intensification",
  "predrop",
  "drop",
  "fake-drop",
  "drop-continuation",
  "breakdown",
  "bass-re-entry",
  "drum-re-entry",
  "vocal-entry",
  "vocal-exit",
  "fill",
  "pause",
  "silence",
  "large-transient",
  "final-hit",
  "outro-release",
]);
export type MusicalEventType = z.infer<typeof musicalEventTypeSchema>;

export const gridWarningSchema = z.object({
  source: z.string(),
  medianOffsetMs: z.number(),
  p95OffsetMs: z.number(),
  driftMs: z.number(),
  evidence: z.array(z.string()),
  beatRange: z.tuple([z.number(), z.number()]),
  segments: z.array(
    z.object({
      startAnchor: z.number(),
      endAnchor: z.number(),
      medianShiftMs: z.number(),
      note: z.string().optional(),
    }).strict(),
  ),
}).strict();
export type GridWarning = z.infer<typeof gridWarningSchema>;

export const beatFeatureSchema = z.object({
  beat: z.number().int().positive(),
}).catchall(z.number());
export type BeatFeature = z.infer<typeof beatFeatureSchema>;

export const frameFeaturesRefSchema = z.object({
  artifactPath: z.string(),
  stemSource: z.string(),
  activationFps: z.number().optional(),
}).strict();
export type FrameFeaturesRef = z.infer<typeof frameFeaturesRefSchema>;

export const musicalKeySchema = z.object({
  key: z.string(),
  mode: z.enum(["major", "minor"]),
  confidence: z.number().min(0).max(1),
}).strict();
export type MusicalKey = z.infer<typeof musicalKeySchema>;

export const inputEntrySchema = z.object({
  status: z.enum(["present", "absent", "failed", "skipped"]),
  reason: z.string().optional(),
  version: z.string().optional(),
  durationMs: z.number().optional(),
}).strict();
export type InputEntry = z.infer<typeof inputEntrySchema>;

export const analysisInputsSchema = z.object({
  "source.audio": inputEntrySchema,
  "native.rekordbox.grid": inputEntrySchema,
  "native.rekordbox.pssi": inputEntrySchema,
  "native.rekordbox.cues": inputEntrySchema,
  "native.rekordbox.waveforms": inputEntrySchema,
  "native.rekordbox.vocal": inputEntrySchema,
  "native.serato.grid": inputEntrySchema,
  "native.serato.markers": inputEntrySchema,
  "ml.allinone.structure": inputEntrySchema,
  "ml.allinone.metrical": inputEntrySchema,
  "ml.allinone.activations": inputEntrySchema,
  "ml.allinone.embeddings": inputEntrySchema,
  "ml.stems": inputEntrySchema,
  "ml.beatthis": inputEntrySchema,
  "dsp.features": inputEntrySchema,
  "dsp.stemProxies": inputEntrySchema,
  "events.detectors": inputEntrySchema,
  "fusion.structure": inputEntrySchema,
  "plan.generated": inputEntrySchema,
}).strict();
export type AnalysisInputs = z.infer<typeof analysisInputsSchema>;

export const phraseSchema = z.object({
  kind: sectionKindSchema,
  rawLabel: z.string().optional(),
  startBeat: z.number(),
  endBeat: z.number(),
  confidence: z.number().min(0).max(1),
  mood: z.number().optional(),
  bank: z.number().optional(),
  fill: z.boolean().optional(),
  fillBeat: z.number().nullable().optional(),
  raw: z.object({
    kind: z.number().int(),
    k1: z.number().int(),
    k2: z.number().int(),
    k3: z.number().int(),
  }).strict().optional(),
}).strict();
export type Phrase = z.infer<typeof phraseSchema>;

const rekordboxCueSchema = z.object({
  position: z.number().optional(),
  loopEnd: z.number().optional(),
  type: z.string().optional(),
  hotcue: z.number().optional(),
  color: z.unknown().optional(),
  rgb: z.unknown().optional(),
  colorId: z.number().optional(),
  comment: z.string().optional(),
  loopNumerator: z.number().optional(),
  loopDenominator: z.number().optional(),
}).catchall(z.unknown());

export const nativeRekordboxSchema = z.object({
  mood: z.number().optional(),
  bank: z.number().optional(),
  endBeatNative: z.number().optional(),
  cues: z.array(rekordboxCueSchema),
  waveformFlags: z.object({
    hasWaveform: z.boolean(),
    hasColorWaveform: z.boolean(),
    has3Band: z.boolean(),
    hasVocals: z.boolean(),
  }).strict(),
  outcomes: z.array(
    z.object({
      tag: z.string(),
      file: z.string(),
      status: z.string(),
      error: z.string().optional(),
    }).strict(),
  ),
}).strict();
export type NativeRekordbox = z.infer<typeof nativeRekordboxSchema>;

export const nativeSeratoSchema = z.object({
  markers: z.array(z.unknown()).optional(),
  grid: z.object({
    beats: z.array(nativeBeatSchema).optional(),
  }).strict().optional(),
}).strict();
export type NativeSerato = z.infer<typeof nativeSeratoSchema>;

export const readinessLevelSchema = z.enum(["full", "structured", "adaptive"]);
export type ReadinessLevel = z.infer<typeof readinessLevelSchema>;

export const trackModelSchema = z.object({
  schemaVersion: z.literal(2),
  analyzerVersion: z.string(),
  identity: trackIdentitySchema,
  durationSeconds: z.number().nonnegative(),
  beatGrid: z.union([beatGridSchema, adaptiveBeatGridSchema]),
  sections: z.array(
    z.object({
      kind: sectionKindSchema,
      rawLabel: z.string().optional(),
      startBeat: z.number(),
      endBeat: z.number(),
      confidence: z.number().min(0).max(1),
      evidence: z.array(z.string()).optional(),
    }).strict(),
  ),
  musicalEvents: z.array(
    z.object({
      type: musicalEventTypeSchema,
      beat: z.number(),
      endBeat: z.number().optional(),
      confidence: z.number().min(0).max(1),
      strength: z.number().min(0).max(1).optional(),
      evidence: z.array(z.string()).optional(),
      fakeImpactBeat: z.number().optional(),
      actualImpactBeat: z.number().optional(),
      variant: z.string().optional(),
    }).strict(),
  ),
  analysisCoverage: readinessLevelSchema,
  readinessLevel: readinessLevelSchema,
  analysisCoverage2: z.object({
    level: readinessLevelSchema,
    inputs: analysisInputsSchema,
  }).strict(),
  gridWarnings: z.array(gridWarningSchema).default([]),
  beatFeatures: z.array(beatFeatureSchema).default([]),
  phrases: z.array(phraseSchema).default([]),
  frameFeatures: frameFeaturesRefSchema.optional(),
  musicalKey: musicalKeySchema.optional(),
  tempo: z.number().optional(),
  metadata: z.object({
    title: z.string().optional(),
    artist: z.string().optional(),
    album: z.string().optional(),
    genre: z.string().optional(),
    durationSource: z.string().optional(),
  }).strict().optional(),
  nativeAnalysis: z.object({
    rekordbox: nativeRekordboxSchema.optional(),
    serato: nativeSeratoSchema.optional(),
  }).strict().optional(),
}).strict().superRefine((model, ctx) => {
  const n = model.beatGrid.beats.length;
  if (model.analysisCoverage === "adaptive") {
    if (n > 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "adaptive must carry an empty grid", path: ["beatGrid", "beats"] });
    }
  } else if (n === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${model.analysisCoverage}: grid must not be empty`, path: ["beatGrid", "beats"] });
  }
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
  groups: z.array(z.string()).optional(),
});
export type Fixture = z.infer<typeof fixtureSchema>;
export type FixtureInput = z.input<typeof fixtureSchema>;

export interface DJLiveProvider {
  readonly id: string;
  readonly source: DeckSource;
  start(): Promise<void>;
  stop(): Promise<void>;
  getDecks(): readonly DeckState[];
  onDeckState(listener: (state: DeckState) => void): () => void;
  onConnection(listener: (up: boolean) => void): () => void;
}
