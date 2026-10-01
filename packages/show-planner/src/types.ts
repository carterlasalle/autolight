// Shared planner types (T-PLAN-01). All positions are Beat: fractional,
// 1-based beats where beat 1 is the first grid beat. No seconds or
// milliseconds fields appear in plan types; sub-beat impact durations use
// EnvelopeTime and convert through tempo at render time.
import type { ShowCue, ShowPlan, TrackModel } from "@autolight/contracts";

export type Beat = number;

export type EnvelopeTime =
  | { readonly kind: "beats"; readonly beats: number }
  | { readonly kind: "ms"; readonly ms: number };

export function envelopeToBeats(e: EnvelopeTime, bpm: number): number {
  if (e.kind === "beats") return e.beats;
  if (!(bpm > 0)) return 0;
  return (e.ms / 1000) * (bpm / 60);
}

export const CUE_LEVELS = ["track", "section", "phrase", "bar", "beat", "sub-beat"] as const;
export type CueLevel = (typeof CUE_LEVELS)[number];

export function isCueLevel(v: string): v is CueLevel {
  return (CUE_LEVELS as readonly string[]).includes(v);
}

// Spec 33 layer names, shared spelling with the renderer layer stack so an
// explicit planner tag wins over the renderer's per-type fallback.
export const PLAN_LAYERS = [
  "base",
  "spatial",
  "rhythm",
  "accents",
  "exclusive",
  "reactive",
  "manual",
  "master",
] as const;
export type PlanLayer = (typeof PLAN_LAYERS)[number];

export function isPlanLayer(v: string): v is PlanLayer {
  return (PLAN_LAYERS as readonly string[]).includes(v);
}

// SpatialSelector (spec 75, WP05 section 4): groups, split parts, zones,
// anchors, field predicates and combinators. Never device IDs.
export type SpatialSelector =
  | { readonly kind: "group"; readonly group: string }
  | { readonly kind: "split"; readonly split: string; readonly part: string }
  | { readonly kind: "zone"; readonly zone: string }
  | { readonly kind: "anchor"; readonly anchor: string }
  | { readonly kind: "field"; readonly field: string; readonly min?: number; readonly max?: number }
  | { readonly kind: "union"; readonly of: readonly SpatialSelector[] }
  | { readonly kind: "intersection"; readonly of: readonly SpatialSelector[] }
  | { readonly kind: "difference"; readonly of: readonly SpatialSelector[] };

export function selectorName(s: SpatialSelector): string {
  switch (s.kind) {
    case "group":
      return s.group;
    case "split":
      return `${s.split}:${s.part}`;
    case "zone":
      return `zone:${s.zone}`;
    case "anchor":
      return `anchor:${s.anchor}`;
    case "field":
      return `field:${s.field}`;
    case "union":
      return s.of.map(selectorName).join("+");
    case "intersection":
      return s.of.map(selectorName).join("&");
    case "difference":
      return s.of.map(selectorName).join("-");
  }
}

const DEVICE_REF =
  /(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}|(?:\d{1,3}\.){3}\d{1,3}|device-id|device_id|segment\s*\d+\s*=|H6076|H1A45|govee\s+(device|lan\s+id)|physical-index|wire-index/i;

export function stringHasDeviceRef(s: string): boolean {
  return DEVICE_REF.test(s);
}

export function selectorHasDeviceRef(s: SpatialSelector): boolean {
  switch (s.kind) {
    case "group":
      return stringHasDeviceRef(s.group);
    case "split":
      return stringHasDeviceRef(s.split) || stringHasDeviceRef(s.part);
    case "zone":
      return stringHasDeviceRef(s.zone);
    case "anchor":
      return stringHasDeviceRef(s.anchor);
    case "field":
      return stringHasDeviceRef(s.field);
    case "union":
    case "intersection":
    case "difference":
      return s.of.some(selectorHasDeviceRef);
  }
}

export interface Oklch {
  readonly l: number;
  readonly c: number;
  readonly h: number;
}

// A cue with typed planning metadata. It extends the legacy ShowCue shape so
// existing consumers keep working: id/level/layer/selector/colour/reason are
// additive and every legacy field stays populated.
export interface PlanCue extends ShowCue {
  readonly id: string;
  readonly level: CueLevel;
  readonly layer: PlanLayer;
  readonly attack?: EnvelopeTime;
  readonly release?: EnvelopeTime;
  readonly selector?: SpatialSelector;
  readonly color?: Oklch;
  readonly paletteRef?: string;
  readonly reason: string;
  readonly justification?: string;
  readonly capability?: string;
  readonly params?: Readonly<Record<string, unknown>>;
}

export interface GlobalDesign {
  readonly primary: readonly Oklch[];
  readonly secondary: readonly Oklch[];
  readonly neutral: Oklch;
  readonly spatialMotif: {
    readonly origin: string;
    readonly direction: "clockwise" | "counterclockwise";
    readonly heads: number;
  };
  readonly movementVocabulary: readonly string[];
  readonly densityBaseline: number;
  readonly contrastBaseline: number;
  readonly impactBudget: number;
  readonly darknessBudgetBeats: number;
}

export interface SectionPlan {
  readonly index: number;
  readonly kind: string;
  readonly startBeat: Beat;
  readonly endBeat: Beat;
  readonly look: string;
  readonly paletteRefs: readonly string[];
  readonly movementFamily: string;
  readonly brightnessRange: readonly [number, number];
  readonly density: number;
  readonly darkness: number;
  readonly groups: readonly string[];
  readonly motifId: string | null;
  readonly mixHints: {
    readonly introBeats: number;
    readonly outroBeats: number;
    readonly incomingPalette: readonly Oklch[];
    readonly exclusiveImpactBeats: readonly number[];
  };
}

export interface MotifEntry {
  readonly id: string;
  readonly baseLook: string;
  readonly sections: readonly number[];
  readonly variations: Readonly<
    Record<
      number,
      {
        readonly direction: string;
        readonly secondaryColor: Oklch | null;
        readonly density: number;
        readonly fixtures: string;
        readonly accentTiming: number;
      }
    >
  >;
}

export interface MotifMap {
  readonly motifs: readonly MotifEntry[];
}

export interface ShowConstraints {
  readonly budgetsUsed: Readonly<Record<string, number>>;
  readonly budgetsRemaining: Readonly<Record<string, number>>;
}

export interface DeterminismRecord {
  readonly fingerprint: string;
  readonly fingerprintSource: "pcm" | "file" | "id";
  readonly plannerVersion: string;
  readonly styleHash: string;
  readonly venueHash: string;
  readonly configHash: string;
  readonly seed: string;
}

export interface CompiledShowPlan extends ShowPlan {
  readonly cues: PlanCue[];
  readonly determinism: DeterminismRecord;
  readonly globalDesign: GlobalDesign;
  readonly sections: SectionPlan[];
  readonly recurrence: MotifMap;
  readonly constraints: ShowConstraints;
}

// VenueCapabilityClass (WP11 section 1): topology classes present, fixture
// counts per role, min fps, capability flags. The planner reads only this
// class, never devices.
export interface VenueCapabilityClass {
  readonly topologies: readonly string[];
  readonly roles: Readonly<Record<string, number>>;
  readonly minFps: number;
  readonly flags: Readonly<Record<string, boolean>>;
}

export const DEFAULT_VENUE_CLASS: VenueCapabilityClass = {
  topologies: ["closed-loop", "vertical-line"],
  roles: { primary: 1, secondary: 2 },
  minFps: 25,
  flags: { strobe: true, whiteHit: true, blackout: true, dip: true },
};

// PlannerConfigSnapshot: every planner number lives here. Callers pass a
// partial; resolveConfig fills registry-mirrored defaults. No other planner
// module may carry a numeric literal for behaviour.
export interface PlannerConfigSnapshot {
  readonly sectionEnergy: Readonly<Record<string, number>>;
  readonly dropMinConfidence: number;
  readonly dropStages: readonly number[];
  readonly dropPreDarknessBeats: number;
  readonly dropBurstBeats: number;
  readonly whiteHitMinBeats: number;
  readonly blackoutMinBeats: number;
  readonly strobeMaxDuty: number;
  readonly paletteChangeMinBeats: number;
  readonly patternRepeatMax: number;
  readonly sectionImpactMax: number;
  readonly trackImpactMax: number;
  readonly breakdownMaxMean: number;
  readonly similarityThreshold: number;
  readonly candidatesPerSection: number;
  readonly chaseBasePeriodBeats: number;
  readonly paletteMinDistance: number;
  readonly eventMinConfidence: Readonly<Record<string, number>>;
  readonly defaultEventConfidence: number;
  readonly evaluationBounds: Readonly<Record<string, readonly [number, number]>>;
  readonly compileBudgetMs: number;
  readonly impactDefaultMs: number;
}

// PlannerStyle: all 11 spec 135 properties. Legacy ShowStyle is the 5-field
// subset plus id; toPlannerStyle lifts it with defaults.
export interface PlannerStyle {
  readonly id: string;
  readonly intensityRange: [number, number];
  readonly darknessPreference: number;
  readonly spatialDensity: number;
  readonly colorSaturation: number;
  readonly paletteChangeRate: number;
  readonly movementDensity: number;
  readonly impactAggression: number;
  readonly whiteHitFrequency: number;
  readonly strobeFrequency: number;
  readonly symmetry: number;
  readonly reactiveAmount: number;
}

export interface PlanDiagnostics {
  readonly activeDensity: number;
  readonly darknessPct: number;
  readonly colourChangeRate: number;
  readonly whiteHits: number;
  readonly blackouts: number;
  readonly strobeBeats: number;
  readonly patternRecurrence: number;
  readonly spatialEntropy: number;
  readonly sectionContrast: number;
  readonly intensityArc: number;
}

export interface RejectedCandidate {
  readonly candidate: number;
  readonly reasons: readonly string[];
}

export interface PlanEdits {
  readonly movedEvents: Readonly<Record<string, number>>;
  readonly sectionKindOverrides: Readonly<Record<number, string>>;
  readonly lockedRegions: ReadonlyArray<{ readonly startBeat: Beat; readonly endBeat: Beat }>;
  readonly pinnedCues: readonly PlanCue[];
  readonly deletedCueIds: readonly string[];
  readonly sectionStyles: Readonly<Record<number, Partial<PlannerStyle>>>;
}

export const EMPTY_EDITS: PlanEdits = {
  movedEvents: {},
  sectionKindOverrides: {},
  lockedRegions: [],
  pinnedCues: [],
  deletedCueIds: [],
  sectionStyles: {},
};

export interface FingerprintOf {
  readonly value: string;
  readonly source: "pcm" | "file" | "id";
}

export interface CompileInput {
  readonly track: TrackModel;
  readonly venue: VenueCapabilityClass;
  readonly style: PlannerStyle;
  readonly config: PlannerConfigSnapshot;
  readonly edits?: PlanEdits;
  readonly mode?: "rules" | "scored" | "rules-with-veto";
  readonly seedOverride?: string;
  readonly fingerprintOf?: (track: TrackModel) => FingerprintOf;
}

export interface CompileResult {
  readonly plan: CompiledShowPlan;
  readonly diagnostics: PlanDiagnostics;
  readonly rejected: RejectedCandidate[];
}

export function fnv1aHex(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function stableStringify(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const keys = Object.keys(v as Record<string, unknown>).sort();
  const body = keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`)
    .join(",");
  return `{${body}}`;
}

export function hashValue(v: unknown): string {
  return fnv1aHex(stableStringify(v));
}

export function trackFingerprint(track: TrackModel): { value: string; source: "pcm" | "file" | "id" } {
  const id = track.identity;
  if (id.pcmFingerprint !== undefined && id.pcmFingerprint !== "") {
    return { value: id.pcmFingerprint, source: "pcm" };
  }
  if (id.fileHash !== undefined && id.fileHash !== "") return { value: id.fileHash, source: "file" };
  return { value: id.id, source: "id" };
}

export function mulberry32(seedHex: string): () => number {
  let a = parseInt(seedHex.slice(0, 8), 16) >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
