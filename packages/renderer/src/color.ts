// Shared colour pipeline (T-REND-03, spec 28, 29, 49, 76).
//
// Colours come only from the plan's palette references (OKLCH) through this
// module: OKLCH to OKLab to linear RGB; intensity applied in linear light to
// arbitrary colours; then per fixture: white balance matrix, brightness
// ceiling, per-device gamma, orientation and cell order, then sRGB bytes at
// the transport boundary only. One module used by planner, mixer and
// renderer (DS-09).
//
// The mixer's blend.ts carries the same Ottosson matrices; this module is
// the renderer's side and the consolidation target. Gamma here is the exact
// sRGB transfer, not the 2.2 approximation the layer stack keeps for its
// internal convention.

export interface Oklch {
  L: number;
  C: number;
  h: number;
}

export interface Oklab {
  L: number;
  a: number;
  b: number;
}

export type LinearRgb = [number, number, number];

/** render.gammaDefault: spec 49 approximation before per-device calibration. */
export const DEFAULT_GAMMA = 2.2;

export interface FixtureCalibrationInput {
  /** Per-device gamma from qualification; defaults to render.gammaDefault. */
  gamma?: number;
  /** 0 to 1 ceiling from qualification. */
  brightnessCeiling?: number;
  /** 3x3 white balance matrix in row-major order; identity when absent. */
  whiteBalance?: readonly number[];
  /** Physical segment order; reversed writes flip it. */
  orientation?: "forward" | "reverse";
}

export function oklchToOklab(lch: Oklch): Oklab {
  const h = (lch.h * Math.PI) / 180;
  return { L: lch.L, a: lch.C * Math.cos(h), b: lch.C * Math.sin(h) };
}

export function oklabToOklch(lab: Oklab): Oklch {
  return { L: lab.L, C: Math.sqrt(lab.a * lab.a + lab.b * lab.b), h: ((Math.atan2(lab.b, lab.a) * 180) / Math.PI + 360) % 360 };
}

export function oklabToLinear(lab: Oklab): LinearRgb {
  const l = lab.L + 0.3963377774 * lab.a + 0.2158037573 * lab.b;
  const m = lab.L - 0.1055613458 * lab.a - 0.0638541728 * lab.b;
  const s = lab.L - 0.0894841775 * lab.a - 1.291485548 * lab.b;
  const l3 = l * l * l;
  const m3 = m * m * m;
  const s3 = s * s * s;
  return [
    4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
  ];
}

export function linearToOklab(linear: LinearRgb): Oklab {
  const l = 0.4122214708 * linear[0] + 0.5363325363 * linear[1] + 0.0514459929 * linear[2];
  const m = 0.2119034982 * linear[0] + 0.6806995451 * linear[1] + 0.1073969566 * linear[2];
  const s = 0.0883024619 * linear[0] + 0.2817188376 * linear[1] + 0.6299787005 * linear[2];
  const l1 = Math.cbrt(Math.max(0, l));
  const m1 = Math.cbrt(Math.max(0, m));
  const s1 = Math.cbrt(Math.max(0, s));
  return {
    L: 0.2104542553 * l1 + 0.793617785 * m1 - 0.0040720468 * s1,
    a: 1.9779984951 * l1 - 2.428592205 * m1 + 0.4505937099 * s1,
    b: 0.0259040371 * l1 + 0.7827717662 * m1 - 0.808675766 * s1,
  };
}

/** OKLCH palette reference to linear light. */
export function oklchToLinear(lch: Oklch): LinearRgb {
  return oklabToLinear(oklchToOklab(lch));
}

/** Intensity in linear light: scales every channel together, so hue survives. */
export function applyIntensityLinear(linear: LinearRgb, intensity: number): LinearRgb {
  const f = Math.min(1, Math.max(0, intensity));
  return [linear[0] * f, linear[1] * f, linear[2] * f];
}

/** White balance matrix (row-major); identity when the fixture has none. */
export function applyWhiteBalance(linear: LinearRgb, matrix: readonly number[] | undefined): LinearRgb {
  if (matrix === undefined || matrix.length < 9) return linear;
  return [
    matrix[0]! * linear[0] + matrix[1]! * linear[1] + matrix[2]! * linear[2],
    matrix[3]! * linear[0] + matrix[4]! * linear[1] + matrix[5]! * linear[2],
    matrix[6]! * linear[0] + matrix[7]! * linear[1] + matrix[8]! * linear[2],
  ];
}

/** Exact sRGB transfer at the transport boundary (spec 49, 76). */
export function linearToSrgbByte(value: number, gamma = "srgb"): number {
  const v = Math.min(1, Math.max(0, value));
  if (gamma !== "srgb") {
    const g = typeof gamma === "number" && gamma > 0 ? gamma : DEFAULT_GAMMA;
    return Math.round(Math.pow(v, 1 / g) * 255);
  }
  const s = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, s)) * 255);
}

/** Full per-fixture output: white balance, ceiling, gamma, then sRGB bytes. */
export function fixtureBytes(
  linear: LinearRgb,
  calibration: FixtureCalibrationInput = {},
): [number, number, number] {
  const balanced = applyWhiteBalance(linear, calibration.whiteBalance);
  const ceiling = calibration.brightnessCeiling ?? 1;
  const capped: LinearRgb = [
    Math.min(ceiling, Math.max(0, balanced[0])),
    Math.min(ceiling, Math.max(0, balanced[1])),
    Math.min(ceiling, Math.max(0, balanced[2])),
  ];
  const gamma = calibration.gamma ?? "srgb";
  const transfer = (v: number): number =>
    gamma === "srgb" ? linearToSrgbByte(v) : Math.round(Math.pow(Math.min(1, Math.max(0, v)), 1 / gamma) * 255);
  return [transfer(capped[0]), transfer(capped[1]), transfer(capped[2])];
}

/** Orientation: physical reverse flips logical segment order (spec 42). */
export function orientCells<T>(cells: readonly T[], orientation: "forward" | "reverse"): T[] {
  return orientation === "forward" ? [...cells] : [...cells].reverse();
}
