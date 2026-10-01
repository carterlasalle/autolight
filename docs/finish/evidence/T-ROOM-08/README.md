# T-ROOM-08: Renderer integration

Closes F-REND-04 (with T-REND-04), F-REND-05; probes P-55-latency-global, P-40-cross-device-chase.

## What changed

- Existing `renderWithLatency` kept: the whole venue evaluates at the compensated beat per fixture, so spatial fields and global ordering never change (T-REND-04 evidence owns the 50 ms tempo math).
- Spatial samplers read global `VenueFields`, so a chase spans fixtures by `s`, not by device-local order (P-40). Per-fixture latency offsets sampling only.
- Extent integration via `subCellLevels` keeps heads gliding across 30-segment strips.

## Proof

- P-ROOM-02 probe (seam-crossing orbit, no dark frame) plus renderer spatial tests; pre-existing `index.test.ts` latency tests unchanged and green.
- Renderer suite green (27 tests).

## Delete test

Sample each fixture at the uncompensated beat and the pre-existing latency test goes red. Order cells per device and P-40-style cross-device continuity breaks.

## Seams

Latency ownership stays in `index.ts`; spatial motion stays in `spatial.ts`.
