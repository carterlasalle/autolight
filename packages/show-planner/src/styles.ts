// Show styles (T-PLAN-09, spec 135). All 11 properties, seven built-ins with
// the spec names. Styles are constraints: every property is read by the
// compile path, none is decorative.
import type { PlannerStyle } from "./types.js";

export const STYLE_IDS = ["club", "house", "festival", "lounge", "pop", "dark", "minimal"] as const;
export type BuiltInStyleId = (typeof STYLE_IDS)[number];

function style(
  id: string,
  patch: Partial<Omit<PlannerStyle, "id">> & Pick<PlannerStyle, "intensityRange">,
): PlannerStyle {
  return {
    darknessPreference: 0.3,
    spatialDensity: 0.6,
    colorSaturation: 0.7,
    paletteChangeRate: 0.5,
    movementDensity: 0.6,
    impactAggression: 0.6,
    whiteHitFrequency: 0.5,
    strobeFrequency: 0.2,
    symmetry: 0.5,
    reactiveAmount: 0.15,
    ...patch,
    id,
  };
}

export const BUILT_IN_STYLES: Record<string, PlannerStyle> = {
  club: style("club", {
    intensityRange: [0.2, 1],
    darknessPreference: 0.3,
    spatialDensity: 0.7,
    colorSaturation: 0.8,
    paletteChangeRate: 0.5,
    movementDensity: 0.7,
    impactAggression: 0.7,
    whiteHitFrequency: 0.7,
    strobeFrequency: 0.2,
    symmetry: 0.4,
    reactiveAmount: 0.15,
  }),
  house: style("house", {
    intensityRange: [0.3, 0.9],
    darknessPreference: 0.2,
    spatialDensity: 0.6,
    colorSaturation: 0.7,
    paletteChangeRate: 0.5,
    movementDensity: 0.6,
    impactAggression: 0.5,
    whiteHitFrequency: 0.5,
    strobeFrequency: 0.1,
    symmetry: 0.6,
    reactiveAmount: 0.2,
  }),
  festival: style("festival", {
    intensityRange: [0.4, 1],
    darknessPreference: 0.15,
    spatialDensity: 0.9,
    colorSaturation: 0.9,
    paletteChangeRate: 0.7,
    movementDensity: 0.9,
    impactAggression: 0.9,
    whiteHitFrequency: 0.9,
    strobeFrequency: 0.4,
    symmetry: 0.3,
    reactiveAmount: 0.25,
  }),
  lounge: style("lounge", {
    intensityRange: [0.1, 0.5],
    darknessPreference: 0.5,
    spatialDensity: 0.3,
    colorSaturation: 0.4,
    paletteChangeRate: 0.3,
    movementDensity: 0.3,
    impactAggression: 0.2,
    whiteHitFrequency: 0.1,
    strobeFrequency: 0,
    symmetry: 0.7,
    reactiveAmount: 0.1,
  }),
  pop: style("pop", {
    intensityRange: [0.3, 0.9],
    darknessPreference: 0.2,
    spatialDensity: 0.6,
    colorSaturation: 0.8,
    paletteChangeRate: 0.6,
    movementDensity: 0.6,
    impactAggression: 0.6,
    whiteHitFrequency: 0.6,
    strobeFrequency: 0.15,
    symmetry: 0.5,
    reactiveAmount: 0.2,
  }),
  dark: style("dark", {
    intensityRange: [0.05, 0.6],
    darknessPreference: 0.7,
    spatialDensity: 0.4,
    colorSaturation: 0.4,
    paletteChangeRate: 0.3,
    movementDensity: 0.3,
    impactAggression: 0.4,
    whiteHitFrequency: 0.3,
    strobeFrequency: 0.05,
    symmetry: 0.6,
    reactiveAmount: 0.1,
  }),
  minimal: style("minimal", {
    intensityRange: [0.15, 0.6],
    darknessPreference: 0.4,
    spatialDensity: 0.2,
    colorSaturation: 0.3,
    paletteChangeRate: 0.2,
    movementDensity: 0.2,
    impactAggression: 0.2,
    whiteHitFrequency: 0.2,
    strobeFrequency: 0,
    symmetry: 0.8,
    reactiveAmount: 0.05,
  }),
};

export const DEFAULT_STYLE_ID = "club";

export function resolveStyle(id: string): PlannerStyle {
  return BUILT_IN_STYLES[id] ?? BUILT_IN_STYLES[DEFAULT_STYLE_ID]!;
}

export const STYLE_PROPERTIES = [
  "intensityRange",
  "darknessPreference",
  "spatialDensity",
  "colorSaturation",
  "paletteChangeRate",
  "movementDensity",
  "impactAggression",
  "whiteHitFrequency",
  "strobeFrequency",
  "symmetry",
  "reactiveAmount",
] as const;
export type StyleProperty = (typeof STYLE_PROPERTIES)[number];
