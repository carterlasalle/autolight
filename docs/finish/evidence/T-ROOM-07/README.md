# T-ROOM-07: Spatial primitives

Closes F-ROOM-02, spec 31 (spatial members), 77, 79.

## What changed

- Registry: `packages/show-planner/src/primitives.ts` (T-PLAN-04) holds all 23 section-5 spatial primitives with parameter interfaces, defaults, range validation, coordinates, energy, sections, restraint costs, and topology/rate capability needs.
- Samplers: `packages/renderer/src/spatial.ts` implements every spatial primitive as a pure function of cell fields plus local beat, with `subCellLevels` extent integration (3-tap box) per `render.antialias.subCell` and `SPATIAL_ENVELOPES` attack/release table.
- Unknown types throw (`UnknownPrimitiveError` / `UnknownSpatialError`), never silent-skip (P-ROOM-08).

## Proof

- `packages/renderer/src/spatial.test.ts`: orbit motion plus wrap, beat envelopes plus 90 ms tempo conversion, split alternation by sign, ripple peak/decay, unknown-type rejection.
- `packages/renderer/src/goldens.test.ts`: every spatial primitive renders and hashes deterministically on the square room.

## Delete test

Return constant level from `sampleSpatial` and the orbit/ripple tests go red. Restore the silent default and the unknown-type test goes red.

## Seams

Planner picks by section/event within topology limits (T-ROOM-09); renderer composites per layer (T-ROOM-08).
