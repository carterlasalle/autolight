import type { Fixture } from "@autolight/contracts";
import { applyLogicalOrder, fitRunMapping, logicalToPhysical, orderLogical, rotateLogicalZero, topologyForRuns } from "./placement.js";
import type { MappedCell } from "./placement.js";
import { computeFields, fieldCellsFromMap, pointCells, projectToOutline, runPointAt } from "./fields.js";
import type { FieldCell } from "./fields.js";
import { derivedGroups, resolveSelector, splitWeights, zoneWeights } from "./groups.js";
import { mirrorCheck, runWizardOnSim } from "./wizard.js";
import { exportVenue, importVenue, outlineRuns, setLogicalZero } from "./venue.js";
import type { Venue } from "./venue.js";
import { normalizeOutline, perimeterLength, polygonArea, polygonCentroid, rectangleRoom, samplePath, validateRoom } from "./room.js";
import { clubRectangle, curvedRoom, fieldCellsForReference, lRoom, referenceById, squareChunks, squareMirrored, squareRoom } from "./reference.js";

export {
  applyLogicalOrder, fitRunMapping, logicalToPhysical, orderLogical, rotateLogicalZero, topologyForRuns,
  computeFields, fieldCellsFromMap, pointCells, projectToOutline, runPointAt,
  derivedGroups, resolveSelector, splitWeights, zoneWeights,
  mirrorCheck, runWizardOnSim,
  exportVenue, importVenue, outlineRuns, setLogicalZero,
  normalizeOutline, perimeterLength, polygonArea, polygonCentroid, rectangleRoom, samplePath, validateRoom,
  clubRectangle, curvedRoom, fieldCellsForReference, lRoom, referenceById, squareChunks, squareMirrored, squareRoom, REFERENCE_ROOMS,
};
export type { MappedCell, FieldCell, Venue };
export type { Point2, Point3, Room, RoomAnchors, DjAnchor, CustomAnchor, Opening, SplineGeom, PerimeterZero, PerimeterDirection, MarkerKind } from "./room.js";
export type { Placement, Run, CellMap, CellAnchor, CellPosition, Topology, FixtureTransform, FixtureCapability, VenueFixture } from "./placement.js";
export type { VenueFields, FieldCell as VenueFieldCell, FieldOptions } from "./fields.js";
export type { SplitDef, ZoneDef, Selector, DerivedGroups, RoleGroups } from "./groups.js";
export type { WizardDirection, RunTopology, SimStrip, WizardFit } from "./wizard.js";
export type { Venue as VenueModel, VenueFile, VenueTemplate } from "./venue.js";
export type { ReferenceRoom } from "./reference.js";

export const DEFAULT_GROUPS = ["ALL","LEFT","RIGHT","CENTER","BACK","FRONT","VERTICALS","HORIZONTALS","PRIMARY","SECONDARY","ACCENT","AMBIENT"] as const;

export interface OrderedCell { fixtureId: string; cellIndex: number }
export function globalCellOrder(fixtures: Fixture[]): OrderedCell[] {
  return fixtures
    .flatMap((f) => f.cells.map((c) => ({ fixtureId: f.id, cellIndex: c.index, x: c.position.x, y: c.position.y ?? 0 })))
    .sort((a, b) => a.x - b.x || a.y - b.y)
    .map(({ fixtureId, cellIndex }) => ({ fixtureId, cellIndex }));
}

export interface FixtureCellRef { fixtureId: string; cellIndex: number }
export interface PlacedCell extends FixtureCellRef { x: number; y: number }

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

export const QUALIFICATION_STEPS = [
  "discover", "identify", "power", "brightness", "rgb", "stream",
  "segment-count", "segment-order", "arm-settle", "fps", "latency", "reconnect",
] as const;
export type QualificationStep = (typeof QUALIFICATION_STEPS)[number];

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
