// Colour module (T-PLAN-02, spec 28). Palettes live in OKLCH, distances in
// OKLab, mixing in OKLab linear space. No sRGB interpolation in the planner.
// Matrices are the published OKLab transform (Ottosson), not tunables.
import type { Oklch } from "./types.js";

function srgbByteToLinear(byte: number): number {
  const s = Math.min(1, Math.max(0, byte / 255));

  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function linearToSrgbByte(linear: number): number {
  const c = Math.min(1, Math.max(0, linear));
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;

  return Math.round(s * 255);
}

interface Oklab {
  readonly l: number;
  readonly a: number;
  readonly b: number;
}

function oklchToOklab(c: Oklch): Oklab {
  const rad = (c.h * Math.PI) / 180;

  return { l: c.l, a: c.c * Math.cos(rad), b: c.c * Math.sin(rad) };
}

function oklabDistance(x: Oklab, y: Oklab): number {
  const dl = x.l - y.l;
  const da = x.a - y.a;
  const db = x.b - y.b;

  return Math.sqrt(dl * dl + da * da + db * db);
}

export function oklchDistance(x: Oklch, y: Oklch): number {
  return oklabDistance(oklchToOklab(x), oklchToOklab(y));
}

// Legacy linear-light sRGB mix, kept for the existing unit test and old
// renderer path. Live colour mixing lives in @autolight/show-mixer
// (blendColors, DS-09 spaces).
export function blendRgb(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  const clamped = Math.min(1, Math.max(0, t));
  const la: [number, number, number] = [srgbByteToLinear(a[0]!), srgbByteToLinear(a[1]!), srgbByteToLinear(a[2]!)];
  const lb: [number, number, number] = [srgbByteToLinear(b[0]!), srgbByteToLinear(b[1]!), srgbByteToLinear(b[2]!)];

  const m: [number, number, number] = [
    la[0]! + (lb[0]! - la[0]!) * clamped,
    la[1]! + (lb[1]! - la[1]!) * clamped,
    la[2]! + (lb[2]! - la[2]!) * clamped,
  ];

  return [linearToSrgbByte(m[0]!), linearToSrgbByte(m[1]!), linearToSrgbByte(m[2]!)];
}

export function neutralWhite(): Oklch {
  return { l: 0.95, c: 0.01, h: 0 };
}

// Deterministic core palette: 2 to 3 hues from the seeded rand, chroma from
// the style saturation, lightness from track energy. Distance enforced by the
// caller with ensureMinDistance.
export function generateCorePalette(
  rand: () => number,
  saturation: number,
  energyMean: number,
  third: boolean,
): Oklch[] {
  const chroma = 0.05 + Math.min(1, Math.max(0, saturation)) * 0.2;
  // light stays in [0.55, 0.70]; the ±0.05 offsets below never leave
  // [0.5, 0.8], so no extra clamping is needed to protect the contrast.
  const light = 0.55 + Math.min(1, Math.max(0, energyMean)) * 0.15;
  const h1 = Math.floor(rand() * 360);
  const spread = 120 + Math.floor(rand() * 120);
  const h2 = (h1 + spread) % 360;

  const out: Oklch[] = [
    { l: light, c: chroma, h: h1 },
    { l: light + 0.05, c: chroma, h: h2 },
  ];

  if (third) {
    const h3 = (h1 + 180 + Math.floor(rand() * 60)) % 360;
    out.push({ l: light - 0.05, c: chroma * 0.8, h: h3 });
  }

  return out;
}
// Shift later hues until every pair clears minDistance. The scan covers the
// full hue wheel at 5-degree steps and keeps the best-effort hue when the
// threshold is unreachable (e.g. near-grey palettes where 2*chroma caps the
// distance), so callers always get the maximally-separated palette. The
// return value reports whether every pair clears the threshold.
export interface MinDistanceResult {
  palette: Oklch[];
  satisfied: boolean;
}

export function ensureMinDistance(palette: Oklch[], minDistance: number): MinDistanceResult {
  const out = palette.map((c) => ({ ...c }));
  let satisfied = true;

  for (let i = 1; i < out.length; i++) {
    let best = out[i]!;
    let bestGap = -Infinity;
    let placed = false;

    for (let step = 0; step < 72; step++) {
      const candidate = { ...out[i]!, h: (out[i]!.h + step * 5) % 360 };
      let gap = Infinity;

      for (let j = 0; j < i; j++) {
        gap = Math.min(gap, oklchDistance(candidate, out[j]!));
      }

      if (gap > bestGap) {
        bestGap = gap;
        best = candidate;
      }

      if (gap >= minDistance) {
        out[i] = candidate;
        placed = true;
        break;
      }
    }

    if (!placed) {
      out[i] = best;
      satisfied = false;
    }
  }

  return { palette: out, satisfied };
}
