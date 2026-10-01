import type { PrimitiveName, PrimitiveParams } from "./primitive-params.js";
export type { PrimitiveName, PrimitiveParams } from "./primitive-params.js";
import type { VenueFields } from "@autolight/venue";

export type EnvelopeKind = "attack-release" | "adsr";

export interface Envelope {
  attackBeats: number;
  releaseBeats: number;
}

export function envelopeLevel(localBeat: number, durationBeats: number, env: Envelope): number {
  if (durationBeats <= 0) return 1;
  const t = Math.min(Math.max(0, localBeat), durationBeats);
  const a = Math.min(1, env.attackBeats <= 0 ? 1 : t / env.attackBeats);
  const remain = durationBeats - t;
  const r = Math.min(1, env.releaseBeats <= 0 ? 1 : remain / env.releaseBeats);
  return Math.min(a, r);
}

export function envelopeFromMs(ms: number, bpm: number, releaseBeats = 0.25): Envelope {
  const beats = bpm > 0 ? (Math.max(0, ms) / 1000) * (bpm / 60) : 0;
  return { attackBeats: beats, releaseBeats };
}

export interface SpatialSample {
  level: number;
  hueShift: number;
}

export class UnknownSpatialError extends Error {
  readonly code = "unknown-primitive";
  constructor(readonly primitiveType: string) {
    super(`unknown primitive type: ${primitiveType}`);
  }
}

function gauss(d: number, width: number): number {
  if (width <= 0) return d === 0 ? 1 : 0;
  const z = d / width;
  return Math.exp(-z * z * 2);
}

function wrapDist(a: number, b: number): number {
  const d = Math.abs(a - b) % 1;
  return Math.min(d, 1 - d);
}

function hashNoise(seed: number, i: number): number {
  let h = (seed * 2654435761 + i * 40503) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  return ((h >>> 8) % 1000) / 1000;
}

export function sampleSpatial(
  name: PrimitiveName,
  params: PrimitiveParams[PrimitiveName],
  localBeat: number,
  i: number,
  fields: VenueFields,
): SpatialSample {
  const s = fields.s[i] ?? 0;
  const theta = fields.theta[i] ?? 0;
  const h = fields.h[i] ?? 0;
  const dC = fields.dCenter[i] ?? 0;
  const g = fields.gDj[i] ?? 0;
  const split = fields.signedSplit[i] ?? 0;
  const chainN = fields.count > 1 ? (fields.chain[i] ?? 0) / Math.max(1, fields.count - 1) : 0;
  const ext0 = (fields.extent[i * 6] ?? 0) + (fields.extent[i * 6 + 3] ?? 0);
  void ext0;
  switch (name) {
    case "Orbit":
    case "PerimeterOrbit": {
      const p = params as PrimitiveParams["Orbit"];
      const head = (((localBeat / Math.max(1e-9, p.beatsPerRevolution) + p.phase) % 1) + 1) % 1;
      const dir = p.direction === "clockwise" ? 1 : -1;
      void dir;
      let best = 0;
      for (let hd = 0; hd < p.heads; hd++) {
        const at = (((head + hd / p.heads) % 1) + 1) % 1;
        const d = wrapDist(s, p.direction === "clockwise" ? at : 1 - at);
        const tail = p.tailCells / Math.max(1, fields.count);
        const v = gauss(d, Math.max(1e-3, tail));
        if (v > best) best = v;
      }
      return { level: best, hueShift: 0 };
    }
    case "Ripple": {
      const p = params as PrimitiveParams["Ripple"];
      const travelled = localBeat * p.roomFractionPerBeat * 2;
      let best = 0;
      for (let c = 0; c < p.count; c++) {
        const front = travelled - c * p.width * 2;
        const d = Math.abs(g * 0.5 - front * 0.5);
        best = Math.max(best, gauss(d, p.width) * Math.pow(1 - p.decay, c));
      }
      return { level: best, hueShift: 0 };
    }
    case "RadialPulse": {
      const p = params as PrimitiveParams["RadialPulse"];
      const travelled = localBeat * p.roomFractionPerBeat;
      let best = 0;
      for (let c = 0; c < p.count; c++) {
        best = Math.max(best, gauss(Math.abs(dC - (travelled - c * p.width * 2)), p.width) * Math.pow(1 - p.decay, c));
      }
      return { level: best, hueShift: 0 };
    }
    case "OpposedPulse": {
      const p = params as PrimitiveParams["OpposedPulse"];
      const prog = p.meetBeat > 0 ? Math.min(1.5, localBeat / p.meetBeat) : 1.5;
      const front = prog * 0.5;
      const d1 = Math.abs(g * 0.5 - front);
      const d2 = Math.abs((1 - g * 0.5) - (1 - front));
      void d2;
      const v = gauss(Math.min(d1, Math.abs(g * 0.5 - (1 - front))), p.width);
      return { level: p.passThrough || prog <= 1 ? v : v * Math.max(0, 1.5 - prog), hueShift: 0.5 };
    }
    case "Converge":
    case "Diverge": {
      const p = params as PrimitiveParams["Converge"];
      const prog = Math.min(1, p.meetBeat > 0 ? localBeat / p.meetBeat : 1);
      const dirOut = name === "Converge" ? 1 : -1;
      const from = name === "Converge" ? p.originS : (p.originS + 0.5) % 1;
      const head = (from + dirOut * prog * 0.5 + 1) % 1;
      const head2 = (from - dirOut * prog * 0.5 + 1) % 1;
      const tail = p.tailCells / Math.max(1, fields.count);
      return { level: Math.max(gauss(wrapDist(s, head), Math.max(1e-3, tail)), gauss(wrapDist(s, head2), Math.max(1e-3, tail))), hueShift: 0 };
    }
    case "Radar": {
      const p = params as PrimitiveParams["Radar"];
      const at = ((localBeat / Math.max(1e-9, p.beatsPerRevolution)) % (Math.PI * 2)) * (p.direction === "clockwise" ? 1 : -1);
      let d = Math.abs(theta - at) % (Math.PI * 2);
      if (d > Math.PI) d = Math.PI * 2 - d;
      return { level: gauss(d, p.widthRad), hueShift: 0 };
    }
    case "SplitAlternate": {
      const p = params as PrimitiveParams["SplitAlternate"];
      const half = Math.floor(localBeat / Math.max(1e-9, p.rateBeats)) % 2;
      const side = split >= 0 ? 0 : 1;
      const on = half === side ? 1 : 0;
      return { level: on >= p.duty ? 1 : 0, hueShift: 0 };
    }
    case "QuadrantRotate": {
      const p = params as PrimitiveParams["QuadrantRotate"];
      const t = ((theta % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      const active = Math.floor(localBeat / Math.max(1e-9, p.stepBeats)) % p.sectors;
      const mine = Math.floor((t / (Math.PI * 2)) * p.sectors);
      const want = p.direction === "forward" ? active : p.sectors - 1 - active;
      return { level: mine === want ? 1 : 0.05, hueShift: 0 };
    }
    case "WallStep": {
      const p = params as PrimitiveParams["WallStep"];
      const active = Math.floor(localBeat / Math.max(1e-9, p.stepBeats)) % 4;
      return { level: (fields.wall[i] ?? 0) % 4 === active ? 1 : 0.05, hueShift: 0 };
    }
    case "CornerHits": {
      const p = params as PrimitiveParams["CornerHits"];
      const cornerness = Math.max(0, 1 - (fields.corner[i] ?? 99) / 0.5);
      const pulse = Math.max(0, 1 - (localBeat % 1) / Math.max(1e-9, p.decayBeats));
      return { level: cornerness * (0.3 + 0.7 * pulse), hueShift: 0 };
    }
    case "Fill":
    case "Unfill": {
      const p = params as PrimitiveParams["Fill"];
      const reach = p.progress * (p.bothWays ? 0.5 : 1);
      const d = p.bothWays ? Math.min(wrapDist(s, p.originS), 0.5) : ((s - p.originS + 1) % 1);
      const lit = d <= reach ? 1 : 0.03;
      return { level: name === "Fill" ? lit : 1 - lit + 0.03, hueShift: 0 };
    }
    case "GradientRotate": {
      const p = params as PrimitiveParams["GradientRotate"];
      return { level: 0.6 + 0.4 * Math.sin((s + localBeat * p.speedRevPerBeat) * Math.PI * 2), hueShift: (s + localBeat * p.speedRevPerBeat) % 1 };
    }
    case "Spiral": {
      const p = params as PrimitiveParams["Spiral"];
      const at = (localBeat * p.speedRevPerBeat) % 1;
      const want = (theta / (Math.PI * 2) + h * p.turns * 0.1 + 1) % 1;
      return { level: gauss(wrapDist(want, at), 0.12), hueShift: h * 0.3 };
    }
    case "Breathe": {
      const p = params as PrimitiveParams["Breathe"];
      const wave = 0.5 + 0.5 * Math.sin((localBeat / Math.max(1e-9, p.periodBeats)) * Math.PI * 2 - dC * 3);
      return { level: 1 - p.depth * (1 - wave), hueShift: 0 };
    }
    case "Mirror": {
      void params;
      const u = fields.uv[i * 2] ?? 0.5;
      return { level: gauss(Math.abs(u - 0.5) * 2, 0.4), hueShift: 0 };
    }
    case "SymmetricSweep": {
      const p = params as PrimitiveParams["SymmetricSweep"];
      const prog = ((localBeat / Math.max(1e-9, p.beatsPerSweep)) % 1);
      return { level: Math.max(gauss(wrapDist(s, prog * 0.5), 0.06), gauss(wrapDist(s, 1 - prog * 0.5), 0.06)), hueShift: 0 };
    }
    case "SpatialWipe": {
      const p = params as PrimitiveParams["SpatialWipe"];
      const u = (fields.uv[i * 2] ?? 0) * Math.cos(p.angleRad) + (fields.uv[i * 2 + 1] ?? 0) * Math.sin(p.angleRad);
      const edge = u - 0.5;
      const lit = edge <= 0 ? 1 : Math.max(0, 1 - edge / Math.max(1e-6, p.edge));
      return { level: p.wipeOn ? lit : 1 - lit, hueShift: 0 };
    }
    case "GroupHandoff": {
      const p = params as PrimitiveParams["GroupHandoff"];
      const t = Math.min(1, Math.max(0, (localBeat - (p.handoffBeat - p.overlapBeats)) / Math.max(1e-9, p.overlapBeats * 2)));
      void p;
      return { level: 0.4 + 0.6 * (chainN * (1 - t) + (1 - chainN) * t), hueShift: 0 };
    }
    case "TextureHold": {
      const p = params as PrimitiveParams["TextureHold"];
      const coord = p.field === "s" ? s : (fields.uv[i * 2] ?? 0);
      const cell = Math.floor(coord * p.scale + localBeat * p.speed * 10 + hashNoise(p.seed, 0) * 2);
      const v = hashNoise(p.seed, cell);
      return { level: 1 - p.depth * v, hueShift: 0 };
    }
    case "FinalHit": {
      const p = params as PrimitiveParams["FinalHit"];
      return { level: Math.max(0.05, 1 - localBeat / Math.max(1e-9, p.decayBeats)) * (0.5 + 0.5 * (1 - dC)), hueShift: 0 };
    }
    default:
      throw new UnknownSpatialError(String(name));
  }
}

export function subCellLevels(
  name: PrimitiveName,
  params: PrimitiveParams[PrimitiveName],
  localBeat: number,
  i: number,
  fields: VenueFields,
): number {
  // Note: 3-tap box over neighbours approximates integrating the motion
  // over the cell extent; exact arc-length integration if fields gain density.
  const at = (j: number): number => sampleSpatial(name, params, localBeat, Math.min(fields.count - 1, Math.max(0, j)), fields).level;
  if (fields.count === 0) return 0;
  return (at(i - 1) + at(i) * 2 + at(i + 1)) / 4;
}

export const SPATIAL_ENVELOPES: Record<string, Envelope> = {
  Impact: { attackBeats: 0.04, releaseBeats: 0.5 },
  WhiteHit: { attackBeats: 0.02, releaseBeats: 0.25 },
  DecayHit: { attackBeats: 0.04, releaseBeats: 1 },
  Ripple: { attackBeats: 0.1, releaseBeats: 0.5 },
  FinalHit: { attackBeats: 0.02, releaseBeats: 4 },
};
