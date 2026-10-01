# T-ROOM-05: Spatial field computation

Closes F-ROOM-02, F-ROOM-03, F-REND-05, spec 40, DS-24, DS-25.

## What changed

- `packages/venue/src/fields.ts` (new): every section-3 field in typed arrays indexed by global cell index (`pos`, `extent`, `uv` in the DJ frame, `h`, `s` with DS-25 zero and direction, `theta` about the pivot, `dCenter`/`dDj`, geodesic `gDj` capped at half perimeter, wall/wallPos/corner, side/front-back, chain, physical/logical, unit `tangent`, `signedSplit`). One immutable `VenueFields` per version; perimeter cells use arc position, lamps project by ray to the outline point.

## Proof

- `packages/venue/src/fields.test.ts`: s wrap continuity, geodesic cap plus DJ minimum, corner-lamp projection equals corner s, uv flips on 180-degree DJ turn, unit tangents turning at corners, split sign on both sides, zero move rotates s without moving pos, 2000 cells under 500 ms.
- Venue suite green.

## Delete test

Return constant `s` and the wrap test goes red. Drop the DJ rotation from `rx` and the flip test goes red. Skip the zero subtraction and the rotation test goes red.

## Seams

Renderer samples these arrays directly (T-REND-02/T-ROOM-08); splits read side/signedSplit (T-ROOM-06). `ponytail`: single-threaded loop; chunk if 2000 cells ever exceed budget on target hardware.
