# T-ROOM-01: Room and anchor model

Closes F-ROOM-01, F-VEN-04 (model part); probes P-ROOM-01, P-ROOM-06 (zero persistence).

## What changed

- `packages/venue/src/room.ts` (new): `Room`, anchors (DJ with facing, computed-or-overridden center, audience, custom), wall names, openings, background trace, perimeter zero/direction, logical zero, units with meter storage. Orientation normalized clockwise from above, self-intersections rejected with edge numbers, area positive. Spline geometry (`polyline` or `catmull-rom`) with tolerance-based arc-length sampling, rectangle template.
- Seam vs logical zero vs performance anchor are three separate fields: the seam lives on the run/controller, logical zero is the logical-zero field, anchors are the DJ/center/audience/custom points.

## Proof

- `packages/venue/src/room.test.ts`: orientation normalization, self-intersection rejection, degenerate area rejection, centroid distinct from DJ anchor, spline circle length within 0.15 m of 2 pi.
- Scoped run: `yarn workspace @autolight/venue test --run` 9 files green (43 tests), includes this file.

## Delete test

Remove `normalizeOutline` and the orientation test goes red (CCW stays CCW). Remove the intersection loop and the bowtie test goes red. Return `polygonArea` without `abs` and the degenerate test weakens.

## Seams

`T-ROOM-05` reads `Room` for field computation; `T-ROOM-11` persists it; `T-ROOM-03` edits it on canvas.
