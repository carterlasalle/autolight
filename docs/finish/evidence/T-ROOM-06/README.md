# T-ROOM-06: Groups and splits

Closes F-VEN-03, F-REND-05, F-ROOM-02; probe P-41-derived-groups.

## What changed

- `packages/venue/src/groups.ts` (new): derived groups from geometry (ALL, LEFT/RIGHT/CENTER from DJ-relative side, FRONT/BACK, CEILING/FLOOR, VERTICALS/HORIZONTALS/PERIMETER, CORNERS, NEAR_DJ, WALL names), role defaults (PRIMARY perimeter, SECONDARY lamps), splits (halves with DS-33 feather blending to 0.5 on the line, quadrants/sectors/walls/alternate/rings, drawn line or explicit parts), drawn zones with edge feather, `Selector` resolution by group/split/zone/field-range/anchor, never device ids.

## Proof

- `packages/venue/src/groups.test.ts`: LEFT/RIGHT/CENTER partition the room, halves weights sum to 1 with feather, selectors resolve without device ids.
- P-41 semantics (DJ-relative LEFT) hold by construction.

## Delete test

Route halves through population thirds and the partition test goes red. Remove the feather blend and the weight-sum test goes red.

## Seams

Feeds renderer selector cache (T-REND-05) and planner spatial targets (T-ROOM-09 via PlannerM3 vocabulary).
