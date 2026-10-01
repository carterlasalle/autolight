import type { Fixture, ShowCue, ShowPlan } from "@autolight/contracts";
import { globalCellOrder, resolveTarget, type OrderedCell } from "@autolight/venue";
import {
  cellKey,
  compositeLayers,
  layerForCue,
  linearToSrgbByte,
  scaleLinear,
  srgbByteToLinear,
  type Contribution,
  type LayerContribution,
} from "./layers.js";

// The layer stack is the renderer's public compositing surface (T-REND-01).
export * from "./layers.js";
export * from "./spatial.js";
export * from "./regions.js";
export * from "./capability.js";
// Logical frame at arbitrary beat (§58: random-access state function).
// Blackout = RGB 0,0,0, never power-off (§47). Darkness is a first-class layer
// contribution (T-REND-01): it replaces with black at its alpha instead of
// competing on brightness.

export interface RenderOverrides {
  /** Manual override layer: one colour at one intensity, replacing the stack. */
  manual?: { color: [number, number, number]; intensity: number } | null;
  /** Master intensity, applied in the renderer's last layer every frame. */
  masterIntensity?: number;
}

// Primitive-aware body (§31): each cue type paints its target cells with its
// own spatial shape and lands on its spec 33 layer.
function cueLayerContribution(
  cue: ShowCue,
  beat: number,
  fixtures: Fixture[],
  orderIndex: Map<string, number>,
  orderLen: number,
  topHue: number,
  subHue: number,
  whiteOut: boolean,
): LayerContribution {
  const cells = resolveTarget(fixtures, cue.target);
  const progress = cue.durationBeats > 0 ? (beat - cue.startBeat) / cue.durationBeats : 0;
  const isBlackout = cue.type === "blackout";
  const isDip = cue.type === "dip";
  const contribution = new Map<string, Contribution>();
  for (const cell of cells) {
    const key = cellKey(cell.fixtureId, cell.cellIndex);
    const idx = orderIndex.get(key) ?? 0;
    let level = cue.intensity;
    if (isBlackout) level = 0;
    else if (isDip) level = cue.intensity;
    else if (cue.type === "breakdown-look") level = cue.intensity * 0.6;
    else if (cue.type === "build-ramp") level = cue.intensity * Math.min(1, progress + 0.2);
    else if (cue.type === "chase-flip" || cue.type === "impact" || cue.type === "white-hit") {
      const phase = (beat - cue.startBeat + idx / Math.max(1, orderLen)) % 1;
      level = cue.intensity * (phase < 0.5 ? 1 : 0.15);
    }
    const bounded = Math.min(1, Math.max(0, level));
    const shape = 0.75 + (0.25 * idx) / Math.max(1, orderLen - 1);
    if (isBlackout) {
      contribution.set(key, { color: [0, 0, 0], alpha: 1, blend: "replace" });
      continue;
    }
    if (isDip) {
      // A dip's intensity is the light that remains: multiply in linear space.
      contribution.set(key, { color: [bounded, bounded, bounded], alpha: 1, blend: "multiply" });
      continue;
    }
    // Restrained palette (§28-29): at most 2 hues + white, alternating cells.
    const [r, g, b] = whiteOut ? [255, 255, 255] : hsv2rgb(idx % 2 === 0 ? topHue : subHue, 0.85, 1);
    contribution.set(key, {
      color: [srgbByteToLinear(r), srgbByteToLinear(g), srgbByteToLinear(b)],
      alpha: Math.min(1, Math.max(0, bounded * shape)),
      blend: "over",
    });
  }
  return { layer: layerForCue(cue), cells: contribution };
}

function manualLayer(
  manual: { color: [number, number, number]; intensity: number },
  order: OrderedCell[],
): LayerContribution {
  const alpha = Math.min(1, Math.max(0, manual.intensity));
  const cells = new Map<string, Contribution>();
  for (const cell of order) {
    cells.set(cellKey(cell.fixtureId, cell.cellIndex), {
      color: [
        srgbByteToLinear(manual.color[0]),
        srgbByteToLinear(manual.color[1]),
        srgbByteToLinear(manual.color[2]),
      ],
      alpha,
      blend: "replace",
    });
  }
  return { layer: "manual", cells };
}

export function renderFrame(
  plan: ShowPlan,
  beat: number,
  fixtures: Fixture[],
  overrides: RenderOverrides = {},
): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  for (const f of fixtures) out.set(f.id, new Uint8Array(f.cells.length * 3));
  const active = plan.cues
    .filter((c) => beat >= c.startBeat && beat < c.startBeat + c.durationBeats)
    .sort((a, b) => b.priority - a.priority);
  const order: OrderedCell[] = globalCellOrder(fixtures);
  const orderIndex = new Map<string, number>(order.map((c, i) => [cellKey(c.fixtureId, c.cellIndex), i]));
  const lookHue = (startBeat: number): number => (Math.floor(startBeat) * 137 + 210) % 360;
  const topHue = active.length ? lookHue(active[active.length - 1]!.startBeat) : 210;
  const subHue = active.length > 1 ? lookHue(active[active.length - 2]!.startBeat) : (topHue + 40) % 360;
  const whiteOut = active.some((c) => (c.type === "white-hit" || c.type === "impact") && c.target === "ALL");
  const layers: LayerContribution[] = [];
  for (const cue of [...active].reverse()) {
    layers.push(cueLayerContribution(cue, beat, fixtures, orderIndex, order.length, topHue, subHue, whiteOut));
  }
  const manual = overrides.manual;
  if (manual !== undefined && manual !== null) layers.push(manualLayer(manual, order));
  const composite = compositeLayers(layers);
  scaleLinear(composite, overrides.masterIntensity ?? 1);
  for (const cell of order) {
    const linear = composite.get(cellKey(cell.fixtureId, cell.cellIndex));
    if (linear === undefined) continue;
    const buf = out.get(cell.fixtureId);
    if (buf === undefined) continue;
    buf[cell.cellIndex * 3] = linearToSrgbByte(linear[0]);
    buf[cell.cellIndex * 3 + 1] = linearToSrgbByte(linear[1]);
    buf[cell.cellIndex * 3 + 2] = linearToSrgbByte(linear[2]);
  }
  return out;
}

function hsv2rgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [rp, gp, bp] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((rp + m) * 255), Math.round((gp + m) * 255), Math.round((bp + m) * 255)];
}

export function frameHash(frames: Map<string, Uint8Array>): string {
  // FNV-1a hex: browser-safe (§86 show worker runs the same code as tests).
  let h = 0x811c9dc5;
  const mix = (b: number): void => {
    h ^= b & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  for (const [id, buf] of [...frames].sort(([a], [b]) => (a < b ? -1 : 1))) {
    for (let i = 0; i < id.length; i++) mix(id.charCodeAt(i)!);
    for (const byte of buf) mix(byte);
  }
  return h.toString(16).padStart(8, "0");
}

// Per-fixture latency compensation (§55): slower fixtures sample the plan
// earlier so visible impacts land together.
export function latencyBeats(latencyMs: number, bpm: number): number {
  if (!(bpm > 0)) return 0;
  return (Math.max(0, latencyMs) / 1000) * (bpm / 60);
}

export function renderWithLatency(plan: ShowPlan, beat: number, fixtures: Fixture[], bpm: number): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  for (const f of fixtures) {
    const offset = latencyBeats(f.calibration?.expectedLatencyMs ?? 0, bpm);
    for (const [id, buf] of renderFrame(plan, beat + offset, [f])) out.set(id, buf);
  }
  return out;
}
