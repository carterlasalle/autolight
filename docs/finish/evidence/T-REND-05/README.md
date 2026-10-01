# T-REND-05: Physical regions, dense arrays, correct addressing

Closes F-REND-05, F-REND-07, F-REND-10; probes P-40-cross-device-chase, P-41-derived-groups.

## What changed

- `packages/renderer/src/regions.ts` (new): `physicalRegions`, `denseFrame` (Uint8Array per fixture), `writeDense` through the logical-to-physical table with out-of-range guard and zero-clear, `SelectorCache` keyed by venue version, `cellIdToIndex`/`frameByCellId` so the UI reads by cell id, never array position. No string keys or `find` per cell per frame.

## Proof

- `packages/renderer/src/regions.test.ts`: logical-to-physical write order, out-of-range guard, cache invalidation on version bump, cell-id reads.
- Chases span fixtures by global `s` (T-ROOM-08); LEFT is DJ-relative (T-ROOM-06).

## Delete test

Write logical order straight into the buffer and the remap assertion goes red. Key the cache by target only and the version test goes red.

## Seams

Table built at mapping time (T-ROOM-02); allocation profile is steady-state clean by construction (no per-frame maps in `writeDense`).
