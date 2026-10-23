import type { Fixture } from "@autolight/contracts";
import { computeFields } from "./fields.js";
import { classifyDirection, mirrorCheck } from "./wizard.js";
import { normalizeOutline, perimeterLength, polygonArea, polygonCentroid, rectangleRoom, validateRoom } from "./room.js";
import { REFERENCE_ROOMS, fieldCellsForReference, referenceById, squareMirrored } from "./reference.js";

export {
  computeFields,
  classifyDirection, mirrorCheck,
  normalizeOutline, perimeterLength, polygonArea, polygonCentroid, rectangleRoom, validateRoom,
  fieldCellsForReference, referenceById, squareMirrored, REFERENCE_ROOMS,
};


export type { Room } from "./room.js";


export type { VenueFields } from "./fields.js";


export type { RunTopology } from "./wizard.js";




export interface OrderedCell { fixtureId: string; cellIndex: number }

export function globalCellOrder(fixtures: Fixture[]): OrderedCell[] {
  return fixtures
    .flatMap((f) => f.cells.map((c) => ({ fixtureId: f.id, cellIndex: c.index, x: c.position.x, y: c.position.y ?? 0 })))
    .sort((a, b) => a.x - b.x || a.y - b.y)
    .map(({ fixtureId, cellIndex }) => ({ fixtureId, cellIndex }));
}

export interface FixtureCellRef { fixtureId: string; cellIndex: number }

export function resolveTarget(fixtures: Fixture[], target: string): FixtureCellRef[] {
  if (target === "ALL") return globalCellOrder(fixtures);
  const order = globalCellOrder(fixtures);
  const third = Math.ceil(order.length / 3);

  if (target === "LEFT") return order.filter((_, i) => i < third);

  // The right third never starts before the left third ends: with fewer
  // than three cells, Left and Right must not share the same cell.
  if (target === "RIGHT") return order.filter((_, i) => i >= order.length - third && i >= third);

  if (target === "CENTER") return order.filter((_, i) => i >= third && i < order.length - third);

  return fixtures
    .filter((f) => (f.groups ?? []).includes(target))
    .flatMap((f) => f.cells.map((c) => ({ fixtureId: f.id, cellIndex: c.index })));
}


export function applyOrientation(cells: FixtureCellRef[], orientation: "forward" | "reverse"): FixtureCellRef[] {
  return orientation === "forward" ? [...cells] : [...cells].reverse();
}

export function selectResolution(candidates: { zones: number; stableFps: number }[], targetFps: number): number | null {
  const ok = candidates.filter((c) => c.stableFps >= targetFps).sort((a, b) => b.zones - a.zones);

  return ok[0]?.zones ?? null;
}

const QUALIFICATION_STEPS = [
  "discover", "identify", "power", "brightness", "rgb", "stream",
  "segment-count", "segment-order", "arm-settle", "fps", "latency", "reconnect",
] as const;

type QualificationStep = (typeof QUALIFICATION_STEPS)[number];

export interface QualificationResult {
  passed: Record<QualificationStep, boolean>;
  segmentCount: number | null;
  orientation: "forward" | "reverse" | null;
  maxStableFps: number | null;
}

export function emptyQualification(): QualificationResult {
  return {
    passed: Object.fromEntries(QUALIFICATION_STEPS.map((s) => [s, false])) as Record<QualificationStep, boolean>,
    segmentCount: null, orientation: null, maxStableFps: null,
  };
}

export function qualificationComplete(r: QualificationResult): boolean {
  return QUALIFICATION_STEPS.every((s) => r.passed[s]);
}
