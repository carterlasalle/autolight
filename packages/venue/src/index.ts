import type { Fixture, FixtureCalibration } from "@autolight/contracts";
export type { Fixture, FixtureCalibration };
export const DEFAULT_GROUPS = ["ALL","LEFT","RIGHT","CENTER","BACK","FRONT","VERTICALS","HORIZONTALS","PRIMARY","SECONDARY","ACCENT","AMBIENT"] as const;

export function globalCellOrder(fixtures: Fixture[]): { fixtureId: string; cellIndex: number }[] {
  return fixtures
    .flatMap((f) => f.cells.map((c) => ({ fixtureId: f.id, cellIndex: c.index, x: c.position.x, y: c.position.y ?? 0 })))
    .sort((a, b) => a.x - b.x || a.y - b.y)
    .map(({ fixtureId, cellIndex }) => ({ fixtureId, cellIndex }));
}

export interface FixtureCellRef { fixtureId: string; cellIndex: number }
export interface PlacedCell extends FixtureCellRef { x: number; y: number }

// Shared venue coords: chase math lives here, never per-device (§40, §77).
export function placeFixtures(fixtures: Fixture[]): PlacedCell[] {
  return globalCellOrder(fixtures).map((ref) => {
    const f = fixtures.find((x) => x.id === ref.fixtureId)!;
    const c = f.cells.find((x) => x.index === ref.cellIndex)!;
    return { ...ref, x: c.position.x, y: c.position.y ?? 0 };
  });
}

// Orientation confirm: physical "reverse" flips logical segment order (§42, §52 step 11).
export function applyOrientation(cells: FixtureCellRef[], orientation: "forward" | "reverse"): FixtureCellRef[] {
  return orientation === "forward" ? [...cells] : [...cells].reverse();
}

// Highest stable resolution meeting refresh target (§53).
export function selectResolution(candidates: { zones: number; stableFps: number }[], targetFps: number): number | null {
  const ok = candidates.filter((c) => c.stableFps >= targetFps).sort((a, b) => b.zones - a.zones);
  return ok[0]?.zones ?? null;
}
