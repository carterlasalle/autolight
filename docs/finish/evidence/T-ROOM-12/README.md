# T-ROOM-12: Geometry tests and goldens

Closes F-ROOM-02 (verification).

## What changed

- `packages/venue/src/reference.ts` (new): six reference rooms (square loop with mid-wall-left controller, square mirrored, chunked square with two gaps plus two lamps, 6x10 club rectangle with door gap, L room, curved spline room).
- `packages/venue/src/probes.test.ts`: P-ROOM-01 (head near DJ, not index 0), P-ROOM-02 (seam crossing, bounded jump, no dark frame), P-ROOM-03 (halves alternate by signedSplit sign), P-ROOM-04 (two-way pulse timing), P-ROOM-05 (mirrored topology cannot orbit), P-ROOM-06 (zero persists, remap keeps logical s), P-ROOM-07 (chunk gaps recorded, orbit stays lit).
- `packages/renderer/src/goldens.ts` + `goldens.test.ts` (T-REND-06): per-primitive deterministic hashes on the square room.

## Proof

- Venue suite 43 green including all probes (P-ROOM-08 covered by registry/renderer unknown-type tests); renderer goldens green.
- HW runbook (P-ROOM-01/02/03/04/06 on the owner rig with video) is owner-side and out of scope for SIM.

## Delete test

Move the DJ anchor onto the seam and P-ROOM-01 goes red. Return constant split level and P-ROOM-03 goes red.

## Seams

Golden PNG review is manual; hashes are committed in-test (no `golden:update` writer needed for this family).
