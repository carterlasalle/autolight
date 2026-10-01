# T-FOV-03: Capability-aware rendering for degraded fixtures

Closes DS-21, part of F-GOV-04 follow-through.

## What changed

- `packages/renderer/src/capability.ts` (new; CloudFailover confirmed disjoint from packages/cloud and packages/failover): `EffectiveCapability` per transport (lan-segmented full; ble-segmented 6 colors/20 Hz; lan-basic/ble-basic/matter-basic/cloud-basic single-zone at descending rates), `singleZoneColor` representative modes (`render.singleZone.representative`: mean-linear, center-cell, dominant), `simplifyColors` distinct-color budget merge for BLE, `plannerAvoidsDegraded` keeping motion off degraded fixtures (ambient participants only).

## Proof

- `packages/renderer/src/regions.test.ts` capability block: full vs degraded flags, BLE budget, representative modes, budget merge cap, degraded exclusion. Renderer suite green.

## Delete test

Return full capability for ble-segmented and the degraded flag test goes red. Skip the color merge and the budget test goes red.

## Seams

Failover state machine (T-FOV-01/02) supplies the effective transport; this module only renders to it. Owner visual review video is owner-side.
