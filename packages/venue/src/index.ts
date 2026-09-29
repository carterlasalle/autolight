import type { Fixture } from "@autolight/contracts";
export type { Fixture };
export const DEFAULT_GROUPS = ["ALL","LEFT","RIGHT","CENTER","BACK","FRONT","VERTICALS","HORIZONTALS","PRIMARY","SECONDARY","ACCENT","AMBIENT"] as const;

// All cells share normalized venue coords (§40); global order = x, then y.
export function globalCellOrder(fixtures: Fixture[]): { fixtureId: string; cellIndex: number }[] {
  return fixtures
    .flatMap((f) => f.cells.map((c) => ({ fixtureId: f.id, cellIndex: c.index, x: c.position.x, y: c.position.y ?? 0 })))
    .sort((a, b) => a.x - b.x || a.y - b.y)
    .map(({ fixtureId, cellIndex }) => ({ fixtureId, cellIndex }));
}
