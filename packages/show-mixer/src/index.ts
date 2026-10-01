import type { ShowCue } from "@autolight/contracts";
import {
  DEFAULT_ASSIGNMENT,
  DEFAULT_CROSSFADER,
  audibleWeight,
  crossfaderGain,
  sideOf,
  type CrossfaderConfig,
  type CrossfaderSide,
  type DeckState,
  type WeightOptions,
} from "@autolight/dj-core";
import { LAYER_ORDER, layerForCue, type RenderLayer } from "@autolight/renderer";
import { DEFAULT_BLEND_SPACE, type BlendSpace } from "./blend.js";

export type { CrossfaderConfig, CrossfaderSide, DeckState };
export { DEFAULT_BLEND_SPACE };

// Show mixer (T-MIX-01 to T-MIX-06).
//
// The only way a cue reaches a frame is through this mixer and the renderer,
// in the show host (T-MIX-06). The UI reads the show host snapshot.

// ---------------------------------------------------------------------------
// Layer tags (spec 33, T-PLAN-13): one definition, owned by the renderer.

export type LayerTag = RenderLayer;
export const LAYERS = LAYER_ORDER;
export { layerForCue as cueLayer };

const EXCLUSIVE: Record<string, true> = { blackout: true, "white-hit": true, strobe: true, impact: true };

// Blackout, strobe, white hit and full-room impact are exclusive resources
// (spec 65).
export function isExclusive(type: string): boolean {
  return EXCLUSIVE[type] === true;
}

// ---------------------------------------------------------------------------
// T-MIX-01 Audible weight (spec 63, DS-26)

export interface WeightContext {
  /** Shared crossfader position; without it each deck reports its own value. */
  position?: number;
  crossfader?: Partial<CrossfaderConfig>;
  masterBonus?: number;
}

export function deckWeightOf(state: DeckState, ctx: WeightContext = {}): number {
  const opts: WeightOptions = {};
  if (ctx.position !== undefined) opts.position = ctx.position;
  if (ctx.masterBonus !== undefined) opts.masterBonus = ctx.masterBonus;
  if (ctx.crossfader !== undefined) opts.crossfader = ctx.crossfader;
  return audibleWeight(state, opts);
}

// Unnormalized per-deck weights (spec 64): a lone quiet deck stays quiet.
export function baseWeights(a: DeckState, b: DeckState, ctx: WeightContext = {}): { a: number; b: number } {
  return { a: deckWeightOf(a, ctx), b: deckWeightOf(b, ctx) };
}

/** Gain for one deck from the crossfader position, its side and the curve. */
export function crossfaderGainOf(position: number, deckId: number, cfg: Partial<CrossfaderConfig> = {}): number {
  const curve = cfg.curve ?? DEFAULT_CROSSFADER.curve;
  const assignment = cfg.assignment ?? DEFAULT_ASSIGNMENT;
  return crossfaderGain(position, sideOf(deckId, assignment), curve);
}

// ---------------------------------------------------------------------------
// T-MIX-03 Exclusive impact ownership (spec 65)

export interface OwnerFactorWeights {
  weight: number;
  master: number;
  confidence: number;
  strength: number;
  significance: number;
}

/** mixer.owner.factorWeights default. */
export const DEFAULT_OWNER_FACTORS: OwnerFactorWeights = {
  weight: 1,
  master: 0.3,
  confidence: 0.5,
  strength: 1,
  significance: 0.5,
};

/** mixer.owner.hysteresis default. */
export const DEFAULT_OWNER_HYSTERESIS = 0.1;

// Structural significance of an exclusive cue type; the planner's own
// significance figure wins when it supplies one.
const SIGNIFICANCE_BY_TYPE: Record<string, number> = {
  "white-hit": 1,
  blackout: 0.95,
  impact: 0.9,
  strobe: 0.6,
};

export interface OwnerInput {
  state: DeckState;
  strength: number;
  /** Event confidence supplied by the planner for the firing cue. */
  confidence?: number;
  /** Structural significance supplied by the planner for the firing cue. */
  significance?: number;
  cues?: ShowCue[];
}

export interface OwnerOptions {
  factors?: OwnerFactorWeights;
  hysteresis?: number;
  /** The deck that owns the exclusives right now, if any. */
  current?: "a" | "b" | null;
  weightContext?: WeightContext;
}

export function ownerScore(input: OwnerInput, opts: OwnerOptions = {}): number {
  const factors = opts.factors ?? DEFAULT_OWNER_FACTORS;
  const weight = deckWeightOf(input.state, opts.weightContext ?? {});
  if (weight <= 0) return 0;
  const master = input.state.master === true ? 1 : 0;
  const confidence = input.confidence ?? 1;
  const strength = input.strength;
  const significance =
    input.significance ?? Math.max(
      0,
      ...(input.cues ?? []).filter((c) => isExclusive(c.type)).map((c) => SIGNIFICANCE_BY_TYPE[c.type] ?? 0.5),
    );
  return (
    factors.weight * weight +
    factors.master * master +
    factors.confidence * confidence +
    factors.strength * strength +
    factors.significance * significance
  );
}

// Exclusive impact ownership: the deck with the higher weighted score owns
// blackouts, strobes, white hits and full-room impacts. Hysteresis keeps the
// incumbent until a challenger clearly wins.
export function impactOwner(a: OwnerInput, b: OwnerInput, opts: OwnerOptions = {}): "a" | "b" | null {
  const scoreA = ownerScore(a, opts);
  const scoreB = ownerScore(b, opts);
  if (scoreA <= 0 && scoreB <= 0) return null;
  const hysteresis = opts.hysteresis ?? DEFAULT_OWNER_HYSTERESIS;
  if (opts.current === "a" && scoreA > 0 && scoreB <= scoreA * (1 + hysteresis)) return "a";
  if (opts.current === "b" && scoreB > 0 && scoreA <= scoreB * (1 + hysteresis)) return "b";
  return scoreA >= scoreB ? "a" : "b";
}

// ---------------------------------------------------------------------------
// T-MIX-04 Transition-aware blackout translation (spec 66, DS-18)

export type BlackoutPolicy = "full" | "deck-spatial-dip" | "deck-side-blackout" | "global-partial-dip" | "auto";
export type StructuralState = "pre-drop" | "section-end" | null;

/** mixer.blackout.otherDeckThreshold default. */
export const DEFAULT_BLACKOUT_THRESHOLD = 0.3;
/** auto: side blackout for the loudest other deck, a global dip above mid. */
const AUTO_SIDE_BLACKOUT_AT = 0.8;
const AUTO_GLOBAL_DIP_AT = 0.5;
/** A partial dip keeps a quarter of the light. */
const DIP_INTENSITY = 0.25;

export interface BlackoutContext {
  policy: BlackoutPolicy;
  /** Audible weight of the other deck. */
  otherWeight: number;
  /** The deck that fired the blackout. */
  side: "a" | "b";
  threshold?: number;
  /** Whether each track structurally supports a full blackout (spec 66). */
  structural?: { self: StructuralState; other: StructuralState };
}

export interface BlackoutDecision {
  cue: ShowCue;
  policy: BlackoutPolicy;
  translated: boolean;
  reason: string;
}

// WP05 splits give each deck a side of the room; LEFT is DJ-relative physical
// left, which is deck A's side.
export function deckSideTarget(side: "a" | "b"): string {
  return side === "a" ? "LEFT" : "RIGHT";
}

// The structural context: a build in flight means the track is at a pre-drop,
// and a look ending on the blackout beat means it is at a section end.
export function structuralState(cues: ShowCue[], beat: number): StructuralState {
  if (cues.some((c) => c.type === "build-ramp")) return "pre-drop";
  if (cues.some((c) => Math.abs(c.startBeat + c.durationBeats - beat) < 1)) return "section-end";
  return null;
}

export function blackoutDecision(cue: ShowCue, ctx: BlackoutContext): BlackoutDecision {
  const threshold = ctx.threshold ?? DEFAULT_BLACKOUT_THRESHOLD;
  if (cue.type !== "blackout") {
    return { cue, policy: "full", translated: false, reason: `not a blackout (${cue.type})` };
  }
  if (ctx.otherWeight < threshold) {
    return { cue, policy: "full", translated: false, reason: "other deck below mixer.blackout.otherDeckThreshold" };
  }
  const policy = ctx.policy === "auto" ? autoPolicy(ctx) : ctx.policy;
  const side = deckSideTarget(ctx.side);
  if (policy === "full") {
    return { cue, policy, translated: false, reason: "both tracks structurally support a full blackout" };
  }
  if (policy === "deck-side-blackout") {
    return {
      cue: { ...cue, target: side },
      policy,
      translated: true,
      reason: `other deck at ${ctx.otherWeight.toFixed(2)}: blackout narrowed to the deck's side (${side})`,
    };
  }
  if (policy === "global-partial-dip") {
    return {
      cue: { ...cue, type: "dip", target: "ALL", intensity: DIP_INTENSITY },
      policy,
      translated: true,
      reason: `other deck at ${ctx.otherWeight.toFixed(2)}: blackout translated to a global partial dip`,
    };
  }
  return {
    cue: { ...cue, type: "dip", target: side, intensity: DIP_INTENSITY },
    policy,
    translated: true,
    reason: `other deck at ${ctx.otherWeight.toFixed(2)}: blackout translated to a spatial dip on ${side}`,
  };
}

function autoPolicy(ctx: BlackoutContext): BlackoutPolicy {
  const structural = ctx.structural;
  if (structural !== undefined && structural.self !== null && structural.self === structural.other) return "full";
  if (ctx.otherWeight >= AUTO_SIDE_BLACKOUT_AT) return "deck-side-blackout";
  if (ctx.otherWeight >= AUTO_GLOBAL_DIP_AT) return "global-partial-dip";
  return "deck-spatial-dip";
}

// The translated cue; the reason is available from `blackoutDecision`.
export function translateBlackout(cue: ShowCue, ctx: BlackoutContext): ShowCue {
  return blackoutDecision(cue, ctx).cue;
}

// ---------------------------------------------------------------------------
// T-MIX-05 Incoming deck introduction by layer (spec 67)

export interface IntroThresholds {
  /** mixer.intro.paletteAt. */
  paletteAt: number;
  /** mixer.intro.rhythmAt. */
  rhythmAt: number;
  /** mixer.intro.impactsAt. */
  impactsAt: number;
}

export const INTRO_DEFAULTS: IntroThresholds = { paletteAt: 0.05, rhythmAt: 0.3, impactsAt: 0.7 };

export type IntroStage = "silent" | "palette" | "rhythm" | "impacts";

export function introductionStage(weight: number, thresholds: IntroThresholds = INTRO_DEFAULTS): IntroStage {
  if (weight < thresholds.paletteAt) return "silent";
  if (weight < thresholds.rhythmAt) return "palette";
  if (weight < thresholds.impactsAt) return "rhythm";
  return "impacts";
}

const ADMITTED: Record<IntroStage, readonly LayerTag[]> = {
  silent: [],
  palette: ["base", "spatial"],
  rhythm: ["base", "spatial", "rhythm", "accents"],
  impacts: LAYERS,
};

// Palette and secondary spatial layer, then rhythm layers, then exclusive
// impacts (spec 67), decided by layer tag, never by cue priority.
export function admits(stage: IntroStage, layer: LayerTag): boolean {
  return ADMITTED[stage].includes(layer);
}

// ---------------------------------------------------------------------------
// T-MIX-06 One path to pixels

export interface DeckMix {
  state: DeckState;
  beat: number;
  cues: ShowCue[];
  impactStrength: number;
  confidence?: number;
  significance?: number;
}

export interface MixedLayer {
  tag: LayerTag;
  side: "a" | "b";
  cues: ShowCue[];
}

export interface DroppedCue {
  side: "a" | "b";
  cue: ShowCue;
  reason: string;
}

export interface MixOptions extends OwnerOptions, WeightContext {
  intro?: IntroThresholds;
  blackoutPolicy?: BlackoutPolicy;
  blackoutThreshold?: number;
  blendSpace?: BlendSpace;
}

export interface MixResult {
  owner: "a" | "b" | null;
  cues: ShowCue[];
  /** Cues that did not reach the frame, each with its recorded reason. */
  dropped: DroppedCue[];
  weights: { a: number; b: number };
  blendSpace: BlendSpace;
  layers: MixedLayer[];
}

// Two-deck mix-down (spec 62 to 67): the owner keeps the exclusive resources,
// a non-owner's exclusive cue is translated or dropped with a recorded reason,
// and each deck contributes only the layers its weight has introduced.
export function mixDown(a: DeckMix, b: DeckMix, opts: MixOptions = {}): MixResult {
  const weights = baseWeights(a.state, b.state, opts);
  const ownerInput = (deck: DeckMix): OwnerInput => {
    const input: OwnerInput = { state: deck.state, strength: deck.impactStrength, cues: deck.cues };
    if (deck.confidence !== undefined) input.confidence = deck.confidence;
    if (deck.significance !== undefined) input.significance = deck.significance;
    return input;
  };
  const owner = impactOwner(ownerInput(a), ownerInput(b), opts);
  const intro = opts.intro ?? INTRO_DEFAULTS;
  const dropped: DroppedCue[] = [];
  const layers: MixedLayer[] = [];
  const kept: ShowCue[] = [];

  const contribute = (deck: DeckMix, side: "a" | "b", weight: number, other: DeckMix, otherWeight: number): void => {
    const stage = introductionStage(weight, intro);
    for (const cue of deck.cues) {
      const layer = layerForCue(cue);
      if (!admits(stage, layer)) {
        dropped.push({ side, cue, reason: `introduction stage ${stage} does not admit the ${layer} layer` });
        continue;
      }
      if (weight <= 0) {
        dropped.push({ side, cue, reason: "deck is not audible" });
        continue;
      }
      const exclusive = isExclusive(cue.type);
      // Transition-aware blackout translation (DS-18) applies to whichever
      // deck fired the blackout while the other deck is audible; the winner of
      // the exclusive resource keeps it, the loser's is translated or dropped.
      if (cue.type === "blackout") {
        const context: BlackoutContext = {
          policy: opts.blackoutPolicy ?? "auto",
          otherWeight,
          side,
          structural: {
            self: structuralState(deck.cues, cue.startBeat),
            other: structuralState(other.cues, cue.startBeat),
          },
        };
        if (opts.blackoutThreshold !== undefined) context.threshold = opts.blackoutThreshold;
        const decision = blackoutDecision(cue, context);
        if (!decision.translated && owner !== side) {
          dropped.push({ side, cue, reason: `exclusive ownership: ${decision.reason}` });
          continue;
        }
        kept.push(decision.cue);
        addLayer(layers, layer, side, decision.cue);
        continue;
      }
      if (exclusive && owner !== side) {
        dropped.push({ side, cue, reason: `exclusive ownership: ${owner ?? "nobody"} owns ${cue.type}` });
        continue;
      }
      const scaled: ShowCue = { ...cue, intensity: Math.min(1, Math.max(0, cue.intensity * weight)) };
      kept.push(scaled);
      addLayer(layers, layer, side, scaled);
    }
  };

  contribute(a, "a", weights.a, b, weights.b);
  contribute(b, "b", weights.b, a, weights.a);
  layers.sort((x, y) => LAYERS.indexOf(x.tag) - LAYERS.indexOf(y.tag) || (x.side === y.side ? 0 : x.side === "a" ? -1 : 1));
  return {
    owner,
    cues: kept,
    dropped,
    weights,
    blendSpace: opts.blendSpace ?? DEFAULT_BLEND_SPACE,
    layers,
  };
}

function addLayer(layers: MixedLayer[], tag: LayerTag, side: "a" | "b", cue: ShowCue): void {
  const existing = layers.find((l) => l.tag === tag && l.side === side);
  if (existing === undefined) layers.push({ tag, side, cues: [cue] });
  else existing.cues.push(cue);
}

// ---------------------------------------------------------------------------
// Track load fast path (§138): cached TrackModel → cached ShowPlan → deck.
// No ML in this path; a missing plan compiles from cached features by caller.
export interface LoadedDeck {
  trackJson: string | null;
  planJson: string | null;
}

export function loadFastPath(
  store: {
    loadArtifact(trackId: string, analyzerVersion: string, fingerprint: string): string | null;
    loadShowPlan(trackId: string, styleId: string, plannerVersion: string): string | null;
  },
  trackId: string,
  analyzerVersion: string,
  fingerprint: string,
  styleId: string,
  plannerVersion: string,
): LoadedDeck {
  const trackJson = store.loadArtifact(trackId, analyzerVersion, fingerprint);
  if (!trackJson) return { trackJson: null, planJson: null };
  return { trackJson, planJson: store.loadShowPlan(trackId, styleId, plannerVersion) };
}
