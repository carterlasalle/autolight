import type { Fixture, ShowCue, ShowPlan } from "@autolight/contracts";
import { globalCellOrder, resolveTarget, type OrderedCell } from "@autolight/venue";

// Logical frame at arbitrary beat (§58: random-access state function).
// Blackout = RGB 0,0,0, never power-off (§47). Linear-light intensity scale (§49).
function linearScale(v: number, intensity: number): number {
  const lin = Math.pow(v / 255, 2.2) * intensity;
  return Math.round(Math.pow(Math.max(0, Math.min(1, lin)), 1 / 2.2) * 255);
}

// Primitive-aware body (§31): each cue type paints its target cells with its
// own spatial shape. Venue targets route via resolveTarget; the top-priority
// cue wins per cell, so breakdowns mute chases beneath them.
function paintCue(
  cue: ShowCue,
  beat: number,
  fixtures: Fixture[],
  lit: Map<string, number>,
  orderIndex: Map<string, number>,
  orderLen: number,
): void {
  const cells = resolveTarget(fixtures, cue.target);
  const progress = cue.durationBeats > 0 ? (beat - cue.startBeat) / cue.durationBeats : 0;
  for (const cell of cells) {
    const key = `${cell.fixtureId}:${cell.cellIndex}`;
    const idx = orderIndex.get(key) ?? 0;
    let level = cue.intensity;
    if (cue.type === "blackout") level = 0;
    else if (cue.type === "dip") level = cue.intensity * 0.25;
    else if (cue.type === "breakdown-look") level = cue.intensity * 0.6;
    else if (cue.type === "build-ramp") level = cue.intensity * Math.min(1, progress + 0.2);
    else if (cue.type === "chase-flip" || cue.type === "impact" || cue.type === "white-hit") {
      const phase = (beat - cue.startBeat + idx / Math.max(1, orderLen)) % 1;
      level = cue.intensity * (phase < 0.5 ? 1 : 0.15);
    }
    lit.set(key, Math.max(lit.get(key) ?? 0, Math.min(1, level)));
  }
}

export function renderFrame(plan: ShowPlan, beat: number, fixtures: Fixture[]): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  for (const f of fixtures) out.set(f.id, new Uint8Array(f.cells.length * 3));
  const active = plan.cues
    .filter((c) => beat >= c.startBeat && beat < c.startBeat + c.durationBeats)
    .sort((a, b) => b.priority - a.priority);
  if (active.some((c) => c.type === "blackout" && c.target === "ALL")) {
    return out; // full-room blackout wins over everything (§66 lets mixer narrow it first)
  }
  const order: OrderedCell[] = globalCellOrder(fixtures);
  const orderIndex = new Map<string, number>(order.map((c, i) => [`${c.fixtureId}:${c.cellIndex}`, i]));
  const lit = new Map<string, number>();
  for (const cue of [...active].reverse()) paintCue(cue, beat, fixtures, lit, orderIndex, order.length);
  // Restrained palette (§28-29): at most 2 hues + white. Hue is per-section
  // (seeded by the look's start beat), not per-cell — cells sharing a look
  // share a color, with left→right brightness shaping for movement feel.
  const lookHue = (startBeat: number): number => (Math.floor(startBeat) * 137 + 210) % 360;
  const topHue = active.length ? lookHue(active[active.length - 1]!.startBeat) : 210;
  const subHue = active.length > 1 ? lookHue(active[active.length - 2]!.startBeat) : (topHue + 40) % 360;
  const entries: [number, OrderedCell][] = [...order.entries()];
  for (const [i, cell] of entries) {
    const fix = fixtures.find((f) => f.id === cell.fixtureId)!;
    const buf = out.get(fix.id)!;
    const level = lit.get(`${cell.fixtureId}:${cell.cellIndex}`) ?? 0;
    if (level <= 0) continue;
    const isTop = (orderIndex.get(`${cell.fixtureId}:${cell.cellIndex}`) ?? 0) % 2 === 0;
    const whiteOut = active.some((c) => (c.type === "white-hit" || c.type === "impact") && c.target === "ALL");
    const hue = whiteOut ? -1 : isTop ? topHue : subHue;
    const shape = 0.75 + (0.25 * i) / Math.max(1, order.length - 1);
    const [r, g, b] = hue < 0 ? [255, 255, 255] : hsv2rgb(hue, 0.85, 1);
    const k = (linearScale(255, Math.min(1, level * shape)) / 255);
    buf[cell.cellIndex * 3] = Math.round(r * k);
    buf[cell.cellIndex * 3 + 1] = Math.round(g * k);
    buf[cell.cellIndex * 3 + 2] = Math.round(b * k);
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
