# T-ROOM-02: Placements and Fixture v2

Closes F-VEN-01, spec 38, 39; probes P-ROOM-06 (remap keeps logical goldens).

## What changed

- `packages/venue/src/placement.ts` (new): `Placement` (point, vertical, path), `Run` (polyline, closed, mirroredOf, spline geom, gaps, controller), `CellMap` with `physicalIndex` plus `logicalIndex`, topology classes, fixture transform/capabilities. Arc-length fit through anchors rejects non-monotonic fits; `logicalToPhysical` table decouples logical zero moves from transport order; `migrateFixture` lifts the legacy linear fixture shape.
- `packages/venue/src/index.ts`: legacy `resolveTarget` thirds behavior for LEFT/RIGHT/CENTER preserved for existing renderer/mixer callers; geometry-derived groups live in `groups.ts` for new code.

## Proof

- `packages/venue/src/placement.test.ts`: 20 m loop perimeter, monotonic fit plus non-monotonic rejection, bijection plus zero rotation, topology classification without assuming the owner rig.
- Venue suite green (43 tests).

## Delete test

Delete the monotonic guard and the reversed-anchor test goes red. Return `logicalIndex: i` in `applyLogicalOrder` and the rotation test goes red.

## Seams

`T-ROOM-04` fits runs through this mapping; `T-REND-05` writes frames through the logical table.
