import { z } from "zod";

/**
 * A JSON value exactly as it survives round-trip through a fixture file or
 * the capture log: persisted payloads, LAN replies and stored settings all
 * enter typed code by validating against this shape first. (The govee
 * boundary names the same structure `LanInbound` for its datagrams.)
 */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const deckSourceSchema = z.enum(["rekordbox", "serato"]);

type DeckSource = z.infer<typeof deckSourceSchema>;

const loopStateSchema = z.object({
  active: z.boolean(),
  startSeconds: z.number().nullable(),
  endSeconds: z.number().nullable(),
  beatLength: z.number().nullable(),
});

type LoopState = z.infer<typeof loopStateSchema>;

const trackIdentitySchema = z.object({
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
  // In-process nanosecond clock; the wire form is wireDeckStateSchema below.
  receivedAtNs: z.bigint(),
});

/** JSON-safe form for IPC/worker boundaries: bigint is not JSON-serializable. */
const wireDeckStateSchema = deckStateSchema.extend({
  receivedAtNs: z.string().regex(/^-?\d+$/, "receivedAtNs must be a decimal integer string"),
});

type WireDeckState = z.infer<typeof wireDeckStateSchema>;



export type DeckState = z.infer<typeof deckStateSchema>;

const nativeBeatSchema = z.object({
  index: z.number().int().nonnegative(),
  beatInBar: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  sourceTimeMs: z.number().nonnegative(),
  bpm: z.number().positive(),
});


export const beatGridSchema = z.object({
  beats: z.array(nativeBeatSchema).min(1),
  version: z.number().int().default(1),
}).strict();

export type BeatGrid = z.infer<typeof beatGridSchema>;

const adaptiveBeatGridSchema = z.object({
  // Emptiness is enforced by trackModelSchema's superRefine (with the
  // coverage-specific diagnostic); the array shape here stays unconstrained.
  beats: z.array(nativeBeatSchema),
  version: z.number().int().default(1),
}).strict();


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

  return a.index + ((c.index - a.index) * (ms - a.sourceTimeMs)) / span;
}

export function beatToSourceSeconds(grid: BeatGrid, beat: number): number {
  const b = grid.beats;
  const clamped = Math.min(Math.max(beat, b[0]!.index), b[b.length - 1]!.index);
  const i = Math.floor(clamped);
  const frac = clamped - i;
  // Linear index lookup; switch to binary search if grids grow large (T-RBL-03).
  const a = b.find((x) => x.index === i);

  if (!a) throw new RangeError(`beatToSourceSeconds: no grid anchor for beat ${i}`);
  const c = b.find((x) => x.index === i + 1) ?? a;

  return (a.sourceTimeMs + (c.sourceTimeMs - a.sourceTimeMs) * frac) / 1000;
}

const sectionKindSchema = z.enum([
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


const musicalEventTypeSchema = z.enum([
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


const gridWarningSchema = z.object({
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


const beatFeatureSchema = z.object({
  beat: z.number().int().positive(),
}).catchall(z.number());


const frameFeaturesRefSchema = z.object({
  artifactPath: z.string(),
  stemSource: z.string(),
  activationFps: z.number().optional(),
}).strict();


const musicalKeySchema = z.object({
  key: z.string(),
  mode: z.enum(["major", "minor"]),
  confidence: z.number().min(0).max(1),
}).strict();


const inputEntrySchema = z.object({
  status: z.enum(["present", "absent", "failed", "skipped"]),
  reason: z.string().optional(),
  version: z.string().optional(),
  durationMs: z.number().optional(),
}).strict();

type InputEntry = z.infer<typeof inputEntrySchema>;

const analysisInputsSchema = z.object({
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

const phraseSchema = z.object({
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

type Phrase = z.infer<typeof phraseSchema>;

const colorSchema = z.object({ r: z.number(), g: z.number(), b: z.number() }).strict();

const rekordboxCueSchema = z.object({
  // Legacy aliases kept from earlier decoders; the canonical fields are the
  // timeMs/loopTimeMs/cueType family the Python extractor emits (native.py).
  source: z.string().optional(),
  position: z.number().optional(),
  timeMs: z.number().int().nonnegative().optional(),
  loopEnd: z.number().optional(),
  loopTimeMs: z.number().int().optional(),
  type: z.string().optional(),
  cueType: z.string().optional(),
  hotcue: z.number().int().optional(),
  hot_cue: z.number().int().optional(),
  color: colorSchema.optional(),
  rgb: colorSchema.nullable().optional(),
  colorId: z.number().int().optional(),
  colorCode: z.number().int().optional(),
  comment: z.string().optional(),
  loopNumerator: z.number().int().optional(),
  loopDenominator: z.number().int().optional(),
}).strict();

const nativeRekordboxSchema = z.object({
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


const seratoMarkerSchema = z.object({
  // Serato markers have no decoder in this repo yet, so the shape mirrors
  // the rekordbox cue family (position/loop/type/hotcue/color/comment):
  // mismatched Serato payloads fail here, not in consumers.
  position: z.number().optional(),
  timeMs: z.number().int().nonnegative().optional(),
  startSeconds: z.number().nonnegative().optional(),
  endSeconds: z.number().nonnegative().optional(),
  type: z.string().optional(),
  cueType: z.string().optional(),
  hotcue: z.number().int().optional(),
  color: colorSchema.optional(),
  rgb: colorSchema.nullable().optional(),
  comment: z.string().optional(),
  bpm: z.number().positive().optional(),
}).strict();

const nativeSeratoSchema = z.object({
  markers: z.array(seratoMarkerSchema).optional(),
  grid: z.object({
    beats: z.array(nativeBeatSchema).optional(),
  }).strict().optional(),
}).strict();


const readinessLevelSchema = z.enum(["full", "structured", "adaptive"]);

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

  const lastBeat = n > 0 ? model.beatGrid.beats[n - 1]!.index : 0;

  model.sections.forEach((s, i) => {
    if (s.endBeat < s.startBeat) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "section endBeat must be >= startBeat", path: ["sections", i, "endBeat"] });
    }
  });
  model.phrases.forEach((p, i) => {
    if (p.endBeat < p.startBeat) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "phrase endBeat must be >= startBeat", path: ["phrases", i, "endBeat"] });
    }
  });
  model.musicalEvents.forEach((e, i) => {
    if (e.endBeat !== undefined && e.endBeat < e.beat) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "event endBeat must be >= beat", path: ["musicalEvents", i, "endBeat"] });
    }

    if (e.beat < 0 || e.beat > lastBeat + 64) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "event beat is outside the grid span", path: ["musicalEvents", i, "beat"] });
    }
  });

  if (model.readinessLevel !== model.analysisCoverage2.level) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "readinessLevel must match analysisCoverage2.level", path: ["readinessLevel"] });
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

const showCueSchema = z.object({
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

const fixtureCellSchema = z.object({
  index: z.number().int().nonnegative(),
  position: z.object({ x: z.number(), y: z.number(), z: z.number().optional() }),
  order: z.number().int(),
  tags: z.array(z.string()),
});


const fixtureCalibrationSchema = z.object({
  segmentCount: z.number().int().positive(),
  maxStableFps: z.number().positive(),
  expectedLatencyMs: z.number().nonnegative(),
  armSettleMs: z.number().nonnegative(),
  orientation: z.enum(["forward", "reverse"]),
  gamma: z.number().positive(),
  brightnessCeiling: z.number().min(0).max(1),
  firmwareVersion: z.string(),
});


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


