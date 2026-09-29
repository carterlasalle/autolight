import { createHash } from "node:crypto";
import type { Fixture, ShowPlan } from "@autolight/contracts";
import { globalCellOrder } from "@autolight/venue";

// Logical frame at arbitrary beat (§58: random-access state function).
// Blackout = RGB 0,0,0, never power-off (§47). Linear-light intensity scale (§49).
function linearScale(v: number, intensity: number): number {
  const lin = Math.pow(v / 255, 2.2) * intensity;
  return Math.round(Math.pow(Math.max(0, Math.min(1, lin)), 1 / 2.2) * 255);
}

export function renderFrame(plan: ShowPlan, beat: number, fixtures: Fixture[]): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  for (const f of fixtures) out.set(f.id, new Uint8Array(f.cells.length * 3));
  const active = plan.cues.filter((c) => beat >= c.startBeat && beat < c.startBeat + c.durationBeats);
  const blackout = active.some((c) => c.type === "blackout");
  const order = globalCellOrder(fixtures);
  active.sort((a, b) => b.priority - a.priority);
  const top = active[0];
  for (const [i, cell] of order.entries()) {
    const fix = fixtures.find((f) => f.id === cell.fixtureId)!;
    const buf = out.get(fix.id)!;
    let r = 0, g = 0, b = 0;
    if (!blackout && top) {
      // ponytail: single-hue placeholder body; full primitive library per §31 lands with planner phases
      const hue = (i * 47 + Math.floor(top.startBeat) * 13) % 360;
      [r, g, b] = hsv2rgb(hue, 0.9, 1);
      const k = linearScale(255, top.intensity) / 255;
      r = Math.round(r * k); g = Math.round(g * k); b = Math.round(b * k);
    }
    buf[cell.cellIndex * 3] = r; buf[cell.cellIndex * 3 + 1] = g; buf[cell.cellIndex * 3 + 2] = b;
  }
  return out;
}

function hsv2rgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [rp, gp, bp] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((rp + m) * 255), Math.round((gp + m) * 255), Math.round((bp + m) * 255)];
}

export function frameHash(frames: Map<string, Uint8Array>): string {
  const h = createHash("sha256");
  for (const [id, buf] of [...frames].sort(([a], [b]) => (a < b ? -1 : 1))) { h.update(id); h.update(buf); }
  return h.digest("hex").slice(0, 16);
}
