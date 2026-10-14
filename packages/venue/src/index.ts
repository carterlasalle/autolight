import type { Fixture } from "@autolight/contracts";
import { applyLogicalOrder, fitRunMapping, logicalToPhysical, orderLogical, rotateLogicalZero, topologyForRuns } from "./placement.js";
import type { MappedCell } from "./placement.js";
import { computeFields, fieldCellsFromMap, pointCells, projectToOutline, runPointAt } from "./fields.js";
import type { FieldCell } from "./fields.js";
import { derivedGroups, resolveSelector, splitWeights, zoneWeights } from "./groups.js";
import { classifyDirection, mirrorCheck, runWizardOnSim } from "./wizard.js";
import { exportVenue, importVenue, outlineRuns, setLogicalZero } from "./venue.js";
import type { Venue } from "./venue.js";
import { normalizeOutline, perimeterLength, polygonArea, polygonCentroid, rectangleRoom, samplePath, validateRoom } from "./room.js";
import { REFERENCE_ROOMS, clubRectangle, curvedRoom, fieldCellsForReference, lRoom, referenceById, squareChunks, squareMirrored, squareRoom } from "./reference.js";

export {
  computeFields,
  classifyDirection, mirrorCheck,
  normalizeOutline, perimeterLength, polygonArea, polygonCentroid, rectangleRoom, validateRoom,
  fieldCellsForReference, referenceById, squareMirrored, REFERENCE_ROOMS,
};


export { Room } from "./room.js";;;;;;;;;;;


export { VenueFields, FieldCell as VenueFieldCell } from "./fields.js";;


export { RunTopology } from "./wizard.js";;;;

export { Venue as VenueModel } from "./venue.js";;


export const DEFAULT_GROUPS = ["ALL","LEFT","RIGHT","CENTER","BACK","FRONT","VERTICALS","HORIZONTALS","PRIMARY","SECONDARY","ACCENT","AMBIENT"] as const;

export interface OrderedCell { fixtureId: string; cellIndex: number }

export function globalCellOrder(fixtures: Fixture[]): OrderedCell[] {
  return fixtures
    .flatMap((f) => f.cells.map((c) => ({ fixtureId: f.id, cellIndex: c.index, x: c.position.x, y: c.position.y ?? 0 })))
    .sort((a, b) => a.x - b.x || a.y - b.y)
    .map(({ fixtureId, cellIndex }) => ({ fixtureId, cellIndex }));
}

export interface FixtureCellRef { fixtureId: string; cellIndex: number }

interface PlacedCell extends FixtureCellRef { x: number; y: number }

export function resolveTarget(fixtures: Fixture[], target: string): FixtureCellRef[] {
  if (target === "ALL") return globalCellOrder(fixtures);
  const order = globalCellOrder(fixtures);

  if (target === "LEFT") return order.filter((_, i) => i < Math.ceil(order.length / 3));

  if (target === "RIGHT") return order.filter((_, i) => i >= order.length - Math.ceil(order.length / 3));

  if (target === "CENTER") return order.filter((_, i) => i >= Math.ceil(order.length / 3) && i < order.length - Math.ceil(order.length / 3));

  return fixtures
    .filter((f) => (f.groups ?? []).includes(target))
    .flatMap((f) => f.cells.map((c) => ({ fixtureId: f.id, cellIndex: c.index })));
}

export function placeFixtures(fixtures: Fixture[]): PlacedCell[] {
  return globalCellOrder(fixtures).map((ref) => {
    const f = fixtures.find((x) => x.id === ref.fixtureId)!;
    const c = f.cells.find((x) => x.index === ref.cellIndex)!;

    return { ...ref, x: c.position.x, y: c.position.y ?? 0 };
  });
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
