// Colour space for the mixer (T-MIX-02, DS-09).
//
// Base layers blend in the space chosen by `mixer.blendSpace`: `oklab`,
// `linear-rgb`, `srgb-legacy` (comparison only), and the combined
// `oklab-hue-linear-intensity` that mixes hue perceptually and applies
// intensity in linear light. Weights are never normalized to one: a lone quiet
// deck produces a proportionally quiet look (spec 64).
//
// The shared colour module used by planner, mixer and renderer is being
// consolidated in `packages/renderer/src/color` (T-REND-03); this module is the
// mixer's side of it and exports the same primitives.

export type BlendSpace = "oklab" | "linear-rgb" | "srgb-legacy" | "oklab-hue-linear-intensity";

/** mixer.blendSpace default: the DS-09 combined mode. */
export const DEFAULT_BLEND_SPACE: BlendSpace = "oklab-hue-linear-intensity";

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Lab {
  L: number;
  a: number;
  b: number;
}

export interface Lch {
  L: number;
  C: number;
  h: number;
}

const SRGB_LINEAR_CUT = 0.04045;

export function srgbToLinear(value: number): number {
  const s = value / 255;
  return s <= SRGB_LINEAR_CUT ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(value: number): number {
  const v = Math.min(1, Math.max(0, value));
  return Math.round((v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055) * 255);
}

export function rgbToLinear(rgb: Rgb): [number, number, number] {
  return [srgbToLinear(rgb.r), srgbToLinear(rgb.g), srgbToLinear(rgb.b)];
}

export function linearToRgb(linear: [number, number, number]): Rgb {
  return { r: linearToSrgb(linear[0]), g: linearToSrgb(linear[1]), b: linearToSrgb(linear[2]) };
}

// Ottosson's OKLab (sRGB D65 primaries), the same matrices the planner uses.
export function linearToOklab(linear: [number, number, number]): Lab {
  const [r, g, b] = linear;
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(Math.max(0, l));
  const m_ = Math.cbrt(Math.max(0, m));
  const s_ = Math.cbrt(Math.max(0, s));
  return {
    L: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  };
}

export function oklabToLinear(lab: Lab): [number, number, number] {
  const l_ = lab.L + 0.3963377774 * lab.a + 0.2158037573 * lab.b;
  const m_ = lab.L - 0.1055613458 * lab.a - 0.0638541728 * lab.b;
  const s_ = lab.L - 0.0894841775 * lab.a - 1.291485548 * lab.b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  return [
    Math.min(1, Math.max(0, 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)),
    Math.min(1, Math.max(0, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)),
    Math.min(1, Math.max(0, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)),
  ];
}

export function oklabToOklch(lab: Lab): Lch {
  const C = Math.sqrt(lab.a * lab.a + lab.b * lab.b);
  const h = ((Math.atan2(lab.b, lab.a) * 180) / Math.PI + 360) % 360;
  return { L: lab.L, C, h };
}

export function rgbToOklch(rgb: Rgb): Lch {
  return oklabToOklch(linearToOklab(rgbToLinear(rgb)));
}

export interface ColourEntry {
  rgb: Rgb;
  /** Unnormalized weight from the audible weight of its deck. */
  weight: number;
}

export interface BlendResult {
  rgb: Rgb;
  /** Linear-light intensity of the result: the unnormalized weight total. */
  intensity: number;
}

export function blendColors(entries: ColourEntry[], space: BlendSpace = DEFAULT_BLEND_SPACE): BlendResult {
  const audible = entries.filter((e) => e.weight > 0);
  if (audible.length === 0) return { rgb: { r: 0, g: 0, b: 0 }, intensity: 0 };
  const total = audible.reduce((sum, e) => sum + e.weight, 0);
  const intensity = Math.min(1, total);
  if (space === "srgb-legacy") {
    return { rgb: linearToRgb(rgbToLinear(scale(mixSrgb(audible, total), intensity))), intensity };
  }
  const colour =
    space === "linear-rgb" ? mixLinearRgb(audible, total) : oklabToLinear(mixOklab(audible, total));
  const scaled: [number, number, number] = [colour[0] * intensity, colour[1] * intensity, colour[2] * intensity];
  return { rgb: linearToRgb(scaled), intensity };
}

function mixSrgb(entries: ColourEntry[], total: number): Rgb {
  let r = 0;
  let g = 0;
  let b = 0;
  for (const e of entries) {
    const w = e.weight / total;
    r += e.rgb.r * w;
    g += e.rgb.g * w;
    b += e.rgb.b * w;
  }
  return { r, g, b };
}

function mixLinearRgb(entries: ColourEntry[], total: number): [number, number, number] {
  const out: [number, number, number] = [0, 0, 0];
  for (const e of entries) {
    const linear = rgbToLinear(e.rgb);
    const w = e.weight / total;
    out[0] += linear[0] * w;
    out[1] += linear[1] * w;
    out[2] += linear[2] * w;
  }
  return out;
}

function mixOklab(entries: ColourEntry[], total: number): Lab {
  const out: Lab = { L: 0, a: 0, b: 0 };
  for (const e of entries) {
    const lab = linearToOklab(rgbToLinear(e.rgb));
    const w = e.weight / total;
    out.L += lab.L * w;
    out.a += lab.a * w;
    out.b += lab.b * w;
  }
  return out;
}

function scale(rgb: Rgb, factor: number): Rgb {
  return { r: rgb.r * factor, g: rgb.g * factor, b: rgb.b * factor };
}
