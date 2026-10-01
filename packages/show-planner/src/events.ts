// Event consumption (T-PLAN-07). Every TrackModel event type maps to planning
// behaviour; confidence gates per type, strength scales intensity. Low
// confidence never means silence and never a full impact; a low-confidence
// drop becomes a Reveal, not a WhiteHit.
import type { TrackModel } from "@autolight/contracts";
import type { PlannerConfigSnapshot, PlannerStyle } from "./types.js";

export type PlannedEventKind =
  | "section-transition"
  | "build-ramp"
  | "intensify"
  | "predrop-hold"
  | "drop"
  | "fake-hold"
  | "continuation"
  | "breakdown-look"
  | "reentry"
  | "vocal-focus"
  | "fill-accent"
  | "dip"
  | "bump"
  | "final-hit"
  | "outro-release";

export interface PlannedEvent {
  readonly beat: number;
  readonly endBeat: number;
  readonly kind: PlannedEventKind;
  readonly cueType: string;
  readonly intensity: number;
  readonly priority: number;
  readonly durationBeats: number;
  readonly layerOverride?: "accents" | "exclusive" | "base" | "spatial" | "rhythm";
  readonly reason: string;
  readonly moved: boolean;
}

function eventConfidenceFloor(type: string, config: PlannerConfigSnapshot): number {
  return config.eventMinConfidence[type] ?? config.defaultEventConfidence;
}

function strengthOf(ev: { readonly strength?: number | undefined }): number {
  return ev.strength === undefined ? 0.7 : Math.min(1, Math.max(0, ev.strength));
}

function clampIntensity(v: number, style: PlannerStyle): number {
  const [lo, hi] = style.intensityRange;
  return Math.min(hi, Math.max(lo, v));
}

export function planEvent(
  type: string,
  beat: number,
  endBeat: number | undefined,
  confidence: number,
  strength: number,
  style: PlannerStyle,
  config: PlannerConfigSnapshot,
  moved: boolean,
): PlannedEvent | null {
  const floor = eventConfidenceFloor(type, config);
  if (confidence < floor * 0.5) return null;
  const soft = confidence < floor;
  const span = Math.max(0, (endBeat ?? beat + 4) - beat);
  switch (type) {
    case "build-start":
      return {
        beat,
        endBeat: endBeat ?? beat + 8,
        kind: "build-ramp",
        cueType: "build-ramp",
        intensity: clampIntensity(0.55 + strength * 0.2, style),
        priority: 50,
        durationBeats: span || 8,
        reason: "build start opens a ramp",
        moved,
      };
    case "build-intensification":
      return {
        beat,
        endBeat: endBeat ?? beat + 4,
        kind: "intensify",
        cueType: "build-ramp",
        intensity: clampIntensity(0.65 + strength * 0.2, style),
        priority: 51,
        durationBeats: span || 4,
        reason: "intensification steepens the ramp",
        moved,
      };
    case "predrop":
      return {
        beat,
        endBeat: endBeat ?? beat + 1,
        kind: "predrop-hold",
        cueType: "dip",
        intensity: clampIntensity(0.1 + style.darknessPreference * 0.1, style),
        priority: 94,
        durationBeats: span || 1,
        layerOverride: "exclusive",
        reason: "pre-drop darkness before the impact",
        moved,
      };
    case "drop":
      if (soft) {
        return {
          beat,
          endBeat: beat + 1,
          kind: "drop",
          cueType: "reveal",
          intensity: clampIntensity(0.7, style),
          priority: 88,
          durationBeats: 1,
          reason: "low-confidence drop becomes a reveal, never a white hit",
          moved,
        };
      }
      // Confident drops that pass the impact-aggression floor stay in the
      // event layer as impacts; the drop engine adds the white hit and body.
      return {
        beat,
        endBeat: beat + 1,
        kind: "drop",
        cueType: "impact",
        intensity: clampIntensity(0.8 + strength * 0.1, style),
        priority: 90,
        durationBeats: 1,
        reason: "confident drop lands as a full-colour impact",
        moved,
      };
    case "fake-drop":
      return {
        beat,
        endBeat: endBeat ?? beat + 2,
        kind: "fake-hold",
        cueType: "blackout",
        intensity: 0,
        priority: 95,
        durationBeats: span || 2,
        reason: "fake drop holds darkness, impact waits for the real beat",
        moved,
      };
    case "drop-continuation":
    case "drop_continuation":
      return {
        beat,
        endBeat: endBeat ?? beat + 8,
        kind: "continuation",
        cueType: "drop-pattern",
        intensity: clampIntensity(0.8, style),
        priority: 60,
        durationBeats: span || 8,
        reason: "drop continuation rides the saturated body",
        moved,
      };
    case "breakdown":
      return {
        beat,
        endBeat: endBeat ?? beat + 16,
        kind: "breakdown-look",
        cueType: "breakdown-look",
        intensity: clampIntensity(0.22 + (soft ? 0.05 : 0), style),
        priority: 40,
        durationBeats: span || 16,
        layerOverride: "base",
        reason: "breakdown opens a low narrow look",
        moved,
      };
    case "bass-reentry":
    case "drum-reentry":
    case "bass_reentry":
    case "drum_reentry":
      return {
        beat,
        endBeat: beat + 1,
        kind: "reentry",
        cueType: soft ? "reveal" : "impact",
        intensity: clampIntensity(0.5 + strength * 0.4, style),
        priority: 85,
        durationBeats: 1,
        reason: "rhythm re-entry lands scaled by strength",
        moved,
      };
    case "vocal-entry":
    case "vocal-exit":
      return {
        beat,
        endBeat: endBeat ?? beat + 8,
        kind: "vocal-focus",
        cueType: soft ? "static-look" : "vocal-focus",
        intensity: clampIntensity(0.4 + strength * 0.3, style),
        priority: 45,
        durationBeats: span || 8,
        reason: "vocal change focuses the look",
        moved,
      };
    case "fill":
      return {
        beat,
        endBeat: endBeat ?? beat + 1,
        kind: "fill-accent",
        cueType: "fill-accent",
        intensity: clampIntensity(0.5 + strength * 0.3, style),
        priority: 55,
        durationBeats: span || 1,
        reason: "fill gets a short accent",
        moved,
      };
    case "pause":
    case "silence":
      return {
        beat,
        endBeat: endBeat ?? beat + 2,
        kind: "dip",
        cueType: soft ? "dip" : "blackout",
        intensity: soft ? clampIntensity(0.15, style) : 0,
        priority: soft ? 80 : 95,
        durationBeats: span || 2,
        layerOverride: "exclusive",
        reason: "silence dips or blacks out within budget",
        moved,
      };
    case "transient":
    case "large-transient":
      return {
        beat,
        endBeat: beat + 0.5,
        kind: "bump",
        cueType: "bump",
        intensity: clampIntensity(0.5 + strength * 0.4, style),
        priority: 70,
        durationBeats: 0.5,
        reason: "large transient bumps",
        moved,
      };
    case "final-hit":
      return {
        beat,
        endBeat: beat + 2,
        kind: "final-hit",
        cueType: "final-hit",
        intensity: clampIntensity(0.95, style),
        priority: 100,
        durationBeats: 2,
        reason: "final hit closes the track",
        moved,
      };
    case "outro-release":
      return {
        beat,
        endBeat: endBeat ?? beat + 8,
        kind: "outro-release",
        cueType: "outro-release",
        intensity: clampIntensity(0.3, style),
        priority: 30,
        durationBeats: span || 8,
        layerOverride: "base",
        reason: "outro releases the energy",
        moved,
      };
    case "section-transition":
      return {
        beat,
        endBeat: beat + 1,
        kind: "section-transition",
        cueType: "phrase-turn",
        intensity: clampIntensity(0.55, style),
        priority: 52,
        durationBeats: 1,
        reason: "section transition turns the phrase",
        moved,
      };
    default:
      return {
        beat,
        endBeat: endBeat ?? beat + 1,
        kind: "fill-accent",
        cueType: "fill-accent",
        intensity: clampIntensity(0.45, style),
        priority: 50,
        durationBeats: span || 1,
        reason: `unlisted event ${type} gets a soft accent, never silence`,
        moved,
      };
  }
}

export function planTrackEvents(
  track: TrackModel,
  style: PlannerStyle,
  config: PlannerConfigSnapshot,
  movedEvents: Readonly<Record<string, number>>,
): PlannedEvent[] {
  const out: PlannedEvent[] = [];
  for (const ev of track.musicalEvents) {
    const movedTo = movedEvents[`${ev.type}@${ev.beat}`];
    const beat = movedTo ?? ev.beat;
    const planned = planEvent(
      ev.type,
      beat,
      ev.endBeat,
      ev.confidence,
      strengthOf(ev),
      style,
      config,
      movedTo !== undefined,
    );
    // A confident drop that is not soft is programmed by the drop engine
    // (contrast.ts), not here; planEvent returns null for it by design.
    if (planned) out.push(planned);
  }
  return out;
}
