// Colour module (T-PLAN-02, spec 28). Palettes live in OKLCH, distances in
// OKLab, mixing in OKLab linear space. No sRGB interpolation in the planner.
// Matrices are the published OKLab transform (Ottosson), not tunables.
import type { Oklch } from "./types.js";

export function srgbByteToLinear(byte: number): number {
  const s = Math.min(1, Math.max(0, byte / 255));
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function linearToSrgbByte(linear: number): number {
  const c = Math.min(1, Math.max(0, linear));
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(s * 255);
}

export interface Oklab {
  readonly l: number;
  readonly a: number;
  readonly b: number;
}

export function oklchToOklab(c: Oklch): Oklab {
  const rad = (c.h * Math.PI) / 180;
  return { l: c.l, a: c.c * Math.cos(rad), b: c.c * Math.sin(rad) };
}

export function oklabToOklch(lab: Oklab): Oklch {
  const c = Math.sqrt(lab.a * lab.a + lab.b * lab.b);
  let h = (Math.atan2(lab.b, lab.a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: lab.l, c, h };
}

export function linearRgbToOklab(r: number, g: number, b: number): Oklab {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  return {
    l: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  };
}

export function oklabDistance(x: Oklab, y: Oklab): number {
  const dl = x.l - y.l;
  const da = x.a - y.a;
  const db = x.b - y.b;
  return Math.sqrt(dl * dl + da * da + db * db);
}

export function oklchDistance(x: Oklch, y: Oklch): number {
  return oklabDistance(oklchToOklab(x), oklchToOklab(y));
}

// Blend in OKLab (the mixer blend space direction), never in sRGB.
export function blendOklch(a: Oklch, b: Oklch, t: number): Oklch {
  const clamped = Math.min(1, Math.max(0, t));
  const la = oklchToOklab(a);
  const lb = oklchToOklab(b);
  const mixed: Oklab = {
    l: la.l + (lb.l - la.l) * clamped,
    a: la.a + (lb.a - la.a) * clamped,
    b: la.b + (lb.b - la.b) * clamped,
  };
  return oklabToOklch(mixed);
}

// Legacy linear-light sRGB mix, kept for the existing unit test and old
// renderer path. New planner code uses blendOklch.
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
  const light = 0.55 + Math.min(1, Math.max(0, energyMean)) * 0.15;
  const h1 = Math.floor(rand() * 360);
  const spread = 120 + Math.floor(rand() * 120);
  const h2 = (h1 + spread) % 360;
  const out: Oklch[] = [
    { l: light, c: chroma, h: h1 },
    { l: Math.min(0.8, light + 0.05), c: chroma, h: h2 },
  ];
  if (third) {
    const h3 = (h1 + 180 + Math.floor(rand() * 60)) % 360;
    out.push({ l: Math.max(0.5, light - 0.05), c: chroma * 0.8, h: h3 });
  }
  return out;
}

// Shift later hues until every pair clears minDistance. Bounded tries so a
// tight threshold cannot loop.
export function ensureMinDistance(palette: Oklch[], minDistance: number): Oklch[] {
  const out = palette.map((c) => ({ ...c }));
  for (let i = 1; i < out.length; i++) {
    let tries = 0;
    while (tries < 12) {
      let ok = true;
      for (let j = 0; j < i; j++) {
        if (oklchDistance(out[i]!, out[j]!) < minDistance) {
          ok = false;
          break;
        }
      }
      if (ok) break;
      out[i] = { ...out[i]!, h: (out[i]!.h + 30) % 360 };
      tries++;
    }
  }
  return out;
}
