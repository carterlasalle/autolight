import type { Fixture } from "@autolight/contracts";
import type { VenueFields } from "@autolight/venue";

export interface PhysicalRegion {
  fixtureId: string;
  startIndex: number;
  length: number;
}

export function physicalRegions(fixtures: Fixture[]): PhysicalRegion[] {
  return fixtures.map((f) => ({ fixtureId: f.id, startIndex: 0, length: f.cells.length }));
}

export function denseFrame(fixtures: Fixture[]): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  for (const f of fixtures) out.set(f.id, new Uint8Array(f.cells.length * 3));
  return out;
}

export function writeDense(
  frames: Map<string, Uint8Array>,
  fixtureId: string,
  logicalRgb: Uint8Array,
  logicalToPhysical: Uint32Array | null,
): void {
  const buf = frames.get(fixtureId);
  if (!buf) return;
  if (!logicalToPhysical) {
    buf.set(logicalRgb.subarray(0, Math.min(buf.length, logicalRgb.length)));
    return;
  }
  const cells = Math.min(logicalToPhysical.length, buf.length / 3, logicalRgb.length / 3);
  buf.fill(0);
  for (let logical = 0; logical < cells; logical++) {
    const physical = logicalToPhysical[logical]!;
    if (physical >= buf.length / 3) continue;
    buf[physical * 3] = logicalRgb[logical * 3]!;
    buf[physical * 3 + 1] = logicalRgb[logical * 3 + 1]!;
    buf[physical * 3 + 2] = logicalRgb[logical * 3 + 2]!;
  }
}

export function selectorCacheKey(version: number, target: string): string {
  return `${version}:${target}`;
}

export class SelectorCache {
  private version = -1;
  private entries: Record<string, string[]> = {};

  resolve(version: number, target: string, compute: () => string[]): string[] {
    if (version !== this.version) {
      this.version = version;
      this.entries = {};
    }
    const key = selectorCacheKey(version, target);
    const hit = this.entries[key];
    if (hit) return hit;
    const value = compute();
    this.entries[key] = value;
    return value;
  }
}

export function cellIdToIndex(fields: VenueFields, cellId: string): number {
  const idx = fields.keys.indexOf(cellId);
  return idx;
}

export function frameByCellId(
  frames: Map<string, Uint8Array>,
  cellId: string,
): [number, number, number] | null {
  const sep = cellId.lastIndexOf(":");
  if (sep < 0) return null;
  const fixtureId = cellId.slice(0, sep);
  const index = Number(cellId.slice(sep + 1));
  if (!Number.isInteger(index) || index < 0) return null;
  const buf = frames.get(fixtureId);
  if (!buf || index * 3 + 2 >= buf.length) return null;
  return [buf[index * 3]!, buf[index * 3 + 1]!, buf[index * 3 + 2]!];
}
