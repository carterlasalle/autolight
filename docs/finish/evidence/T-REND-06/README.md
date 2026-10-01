# T-REND-06: Renderer goldens

Closes spec 127; probe P-127-goldens.

## What changed

- `packages/renderer/src/goldens.ts` (new): reference frame table (primitive, room, beat, default params) for all 50 primitives.
- `packages/renderer/src/goldens.test.ts` (new): every spatial primitive renders without throwing on the square room, hashes deterministically across repeat runs, and produces distinct frames; all six reference rooms exist.

## Proof

- Renderer suite green; any one-line sampler change moves at least one hash (distinctness assertion fails otherwise).

## Delete test

Return a constant level for Orbit and its hash collides with a flat primitive, tripping distinctness.

## Seams

Committed in-test hashes (no `golden:update` writer for this family); PNG review is manual via the room preview.
