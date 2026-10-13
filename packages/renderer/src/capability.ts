import type { Fixture } from "@autolight/contracts";
import { linearToOklab, oklabToLinear } from "./color.js";

export type TransportMode =
  | "lan-segmented"
  | "lan-basic"
  | "ble-segmented"
  | "ble-basic"
  | "matter-basic"
  | "cloud-basic";

export interface EffectiveCapability {
  zones: number;
  maxDistinctColoursPerFrame: number | null;
  /** Null means uncalibrated (unknown rate): schedule conservatively, never as unlimited. */
  maxRateHz: number | null;
  singleZone: boolean;
  transport: TransportMode;
  degraded: boolean;
}

export function capabilityForFixture(f: Fixture, transport: TransportMode = "lan-segmented"): EffectiveCapability {
  const zones = f.cells.length;

  switch (transport) {
    case "lan-segmented":
      return { zones, maxDistinctColoursPerFrame: null, maxRateHz: f.calibration?.maxStableFps ?? null, singleZone: false, transport, degraded: zones === 0 };
    case "lan-basic":
      return { zones: 1, maxDistinctColoursPerFrame: 1, maxRateHz: 10, singleZone: true, transport, degraded: true };
    case "ble-segmented":
      return { zones, maxDistinctColoursPerFrame: 6, maxRateHz: 20, singleZone: false, transport, degraded: true };
    case "ble-basic":
      return { zones: 1, maxDistinctColoursPerFrame: 1, maxRateHz: 10, singleZone: true, transport, degraded: true };
    case "matter-basic":
      return { zones: 1, maxDistinctColoursPerFrame: 1, maxRateHz: 5, singleZone: true, transport, degraded: true };
    case "cloud-basic":
      return { zones: 1, maxDistinctColoursPerFrame: 1, maxRateHz: 1, singleZone: true, transport, degraded: true };
    default:
      throw new RangeError(`unknown transport ${(transport as string) ?? "<empty>"}`);
  }
}

export type SingleZoneMode = "mean-linear" | "area-weighted-mean-oklab" | "dominant" | "center-cell";

export function singleZoneColor(cells: [number, number, number][], mode: SingleZoneMode = "mean-linear"): [number, number, number] {
  if (cells.length === 0) return [0, 0, 0];

  if (mode === "center-cell") return [...cells[Math.floor(cells.length / 2)]!] as [number, number, number];

  if (mode === "dominant") {
    let best = cells[0]!;
    let bestScore = -1;

    for (const c of cells) {
      const score = Math.max(c[0], c[1], c[2]);

      if (score > bestScore) { bestScore = score; best = c; }
    }

    return [...best] as [number, number, number];
  }

  if (mode === "area-weighted-mean-oklab") {
    let l = 0;
    let a = 0;
    let b = 0;

    for (const c of cells) {
      const lab = linearToOklab(c.map((v) => (Math.min(255, Math.max(0, v)) / 255) ** 2.2) as [number, number, number]);
      l += lab.L;
      a += lab.a;
      b += lab.b;
    }

    const n = cells.length;
    const [r, g, bl] = oklabToLinear({ L: l / n, a: a / n, b: b / n });

    return [r, g, bl].map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255)) as [number, number, number];
  }

  let r = 0;
  let g = 0;
  let b = 0;

  for (const c of cells) { r += c[0]; g += c[1]; b += c[2]; }

  const n = cells.length;

  return [r / n, g / n, b / n];
}

function dist2(a: [number, number, number], b: [number, number, number]): number {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];

  return dr * dr + dg * dg + db * db;
}

/**
 * Squared RGB distance below which two colours merge into one palette slot.
 * Units are sRGB bytes (0-255 per channel); 40 ≈ one just-visible step in a
 * saturated channel. Clustering visits cells in input order and averages into
 * the matched slot, so permuting `cells` can change the palette — callers
 * needing positional stability must pass cells in fixture order.
 */
const CLUSTER_MERGE_DIST2 = 40 * 40;

export function simplifyColors(cells: [number, number, number][], budget: number): [number, number, number][] {
  if (budget <= 0 || cells.length <= budget) return cells.map((c) => [...c] as [number, number, number]);
  const palette: [number, number, number][] = [];

  for (const c of cells) {
    let slot = -1;

    for (let i = 0; i < palette.length; i++) {
      if (dist2(c, palette[i]!) < CLUSTER_MERGE_DIST2) { slot = i; break; }
    }

    if (slot < 0) {
      if (palette.length < budget) palette.push([...c] as [number, number, number]);
      else {
        let best = 0;
        let bestD = Infinity;

        for (let i = 0; i < palette.length; i++) {
          const d = dist2(c, palette[i]!);

          if (d < bestD) { bestD = d; best = i; }
        }

        slot = best;
      }
    }

    if (slot >= 0) {
      const p = palette[slot]!;
      p[0] = (p[0] + c[0]) / 2;
      p[1] = (p[1] + c[1]) / 2;
      p[2] = (p[2] + c[2]) / 2;
    }
  }

  return cells.map((c) => {
    let best = palette[0]!;
    let bestD = Infinity;

    for (const p of palette) {
      const d = dist2(c, p);

      if (d < bestD) { bestD = d; best = p; }
    }

    return [...best] as [number, number, number];
  });
}

export function plannerAvoidsDegraded(motionTargets: string[], degradedFixtureIds: string[]): string[] {
  if (degradedFixtureIds.length === 0) return motionTargets;
  const degraded = new Set(degradedFixtureIds);

  return motionTargets.filter((t) => !degraded.has(t));
}
