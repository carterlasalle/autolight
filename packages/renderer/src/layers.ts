import type { ShowCue } from "@autolight/contracts";

// Eight-layer stack with real compositing (T-REND-01, spec 33).
//
// Layers, lowest precedence first: base look, spatial motion, beat modulation,
// musical accents, exclusive impact effects, live reactive overlay, manual
// override, master intensity. Every layer contributes per cell a colour, an
// alpha and a blend mode. Darkness is a first-class contribution: a blackout
// replaces with black at its alpha, so a partial blackout darkens exactly the
// cells it targets instead of losing a brightness comparison.
//
// Darkness shapes and their primitives (T-PLAN-04): a full or targeted
// blackout is a `blackout` cue, whose planner convention is intensity 0 (no
// light) and which the renderer applies as black at alpha 1 for exactly its
// target cells; a partial dip is a `dip` cue whose intensity is the light that
// remains, applied as a linear-light multiply. A translated blackout from the
// mixer uses the dip shape with the light it should keep.

export type RenderLayer =
  | "base"
  | "spatial"
  | "rhythm"
  | "accents"
  | "exclusive"
  | "reactive"
  | "manual"
  | "master";

/** Spec 33 order: later layers win. */
export const LAYER_ORDER: readonly RenderLayer[] = [
  "base",
  "spatial",
  "rhythm",
  "accents",
  "exclusive",
  "reactive",
  "manual",
  "master",
];

type BlendMode = "replace" | "over" | "multiply" | "add" | "max";

/** `add` never exceeds this ceiling (spec 33). */
export const ADD_CEILING = 1;

/** Spec 49 approximation. The shared colour module (T-REND-03) owns the
 * accurate sRGB transfer; this module keeps the renderer's convention. */
const GAMMA = 2.2;

export function srgbByteToLinear(byte: number): number {
  const v = Math.min(255, Math.max(0, byte)) / 255;

  return Math.pow(v, GAMMA);
}

export function linearToSrgbByte(linear: number): number {
  const v = Math.min(1, Math.max(0, linear));

  return Math.round(Math.pow(v, 1 / GAMMA) * 255);
}

/** A layer's contribution to one cell: linear-light colour, alpha, blend. */
export interface Contribution {
  color: [number, number, number];
  alpha: number;
  blend: BlendMode;
}

export interface LayerContribution {
  layer: RenderLayer;
  cells: Map<string, Contribution>;
}

export type LinearCells = Map<string, [number, number, number]>;

export function cellKey(fixtureId: string, cellIndex: number): string {
  return `${fixtureId}:${cellIndex}`;
}

// Cue type to spec 33 layer. An explicit tag from the planner (T-PLAN-13)
// wins; the mapping is the fallback, never a priority heuristic. It mirrors
// the shared spelling in show-planner/src/layers-fallback.ts so untagged
// legacy cues land on the same layer the planner would tag them with.
const CUE_LAYER: Record<string, RenderLayer> = {
  "static-look": "base",
  "section-look": "base",
  "gradient-look": "base",
  "breakdown-look": "base",
  "outro-release": "base",
  orbit: "spatial",
  "perimeter-orbit": "spatial",
  ripple: "spatial",
  "radial-pulse": "spatial",
  "opposed-pulse": "spatial",
  converge: "spatial",
  diverge: "spatial",
  radar: "spatial",
  "split-alternate": "spatial",
  "quadrant-rotate": "spatial",
  "wall-step": "spatial",
  "corner-hits": "spatial",
  fill: "spatial",
  unfill: "spatial",
  "gradient-rotate": "spatial",
  spiral: "spatial",
  breathe: "spatial",
  mirror: "spatial",
  "symmetric-sweep": "spatial",
  "spatial-wipe": "spatial",
  "group-handoff": "spatial",
  "texture-hold": "spatial",
  chase: "spatial",
  "chase-flip": "spatial",
  sweep: "spatial",
  "mirror-sweep": "spatial",
  alternate: "spatial",
  split: "spatial",
  wave: "spatial",
  pulse: "rhythm",
  bump: "rhythm",
  "decay-hit": "rhythm",
  "roll-pattern": "rhythm",
  "build-ramp": "accents",
  "phrase-turn": "accents",
  "fill-accent": "accents",
  "vocal-focus": "accents",
  "drop-pattern": "accents",
  "final-hit": "accents",
  impact: "exclusive",
  "white-hit": "exclusive",
  blackout: "exclusive",
  dip: "exclusive",
  reveal: "exclusive",
  "strobe-burst": "exclusive",
  strobe: "exclusive",
};

const LAYER_LOOKUP: Record<RenderLayer, true> = {
  base: true,
  spatial: true,
  rhythm: true,
  accents: true,
  exclusive: true,
  reactive: true,
  manual: true,
  master: true,
};

function isRenderLayer(value: string): value is RenderLayer {
  return LAYER_LOOKUP[value as RenderLayer] === true;
}

export function layerForCue(cue: ShowCue): RenderLayer {
  if ("layer" in cue) {
    const tagged: unknown = cue.layer;

    if (typeof tagged === "string" && isRenderLayer(tagged)) return tagged;
  }

  return CUE_LAYER[cue.type] ?? "accents";
}

// Composite the stack in spec 33 order, whatever order the caller supplies.
export function compositeLayers(layers: readonly LayerContribution[]): LinearCells {
  const out: LinearCells = new Map();
  const ordered = [...layers].sort((x, y) => LAYER_ORDER.indexOf(x.layer) - LAYER_ORDER.indexOf(y.layer));

  for (const layer of ordered) {
    for (const [key, contribution] of layer.cells) {
      // Multiply is relative to the light underneath: seed empty cells with
      // 1 so a lone dip keeps the light it names instead of going black.
      const previous: [number, number, number] = out.get(key) ?? (contribution.blend === "multiply" ? [1, 1, 1] : [0, 0, 0]);
      out.set(key, blend(previous, contribution));
    }
  }

  return out;
}

function blend(
  previous: [number, number, number],
  contribution: Contribution,
): [number, number, number] {
  const { color, alpha, blend: mode } = contribution;
  const a = Math.min(1, Math.max(0, alpha));

  const c: [number, number, number] = [
    Math.min(1, Math.max(0, color[0])),
    Math.min(1, Math.max(0, color[1])),
    Math.min(1, Math.max(0, color[2])),
  ];

  const channel = (i: 0 | 1 | 2): number => {
    const base = previous[i];

    switch (mode) {
      case "replace":
        return c[i] * a;
      case "over":
        return c[i] * a + base * (1 - a);
      case "multiply":
        return base * (c[i] * a + (1 - a));
      case "add":
        return Math.min(ADD_CEILING, base + c[i] * a);
      case "max":
        return Math.max(base, c[i] * a);
    }
  };

  return [channel(0), channel(1), channel(2)];
}

// Master intensity is the last layer: it scales the composited result in
// linear light, in place.
export function scaleLinear(cells: LinearCells, factor: number): void {
  const f = Math.min(1, Math.max(0, factor));

  if (f === 1) return;

  for (const [key, value] of cells) {
    cells.set(key, [value[0] * f, value[1] * f, value[2] * f]);
  }
}
