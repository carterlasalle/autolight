# T-BLE-05: BLE segment stream

Closes F-BLE-01, F-BLE-02 (segments part), spec 148 (BLE segmented tier). Spec: WP04 T-BLE-05.

## What changed

- `packages/ble/src/stream.ts` (additive): `streamBleRendererFrame` streams one renderer frame (zoneCount RGB triples, as renderFrame produces for one fixture) over the existing planning seam (`planBleFrame`, `encodeBleStreamFrame`). Returns link writes plus `BleFrameFeedback` (distinctColours, effectiveFps budget / distinctColours, singleColour, quantized) so the planner and mixer simplify patterns when effectiveFps drops below show rate. Existing planning, fast path, blackout semantics untouched.
- `packages/ble/src/stream.test.ts` (new): 5 tests. Effective rate reporting, quantisation merging, single-colour fast path plus host colour when qualified, masked blackout (0x33 0x05 0d, never power off), two-colour chase at 20 fps through the paced `BleLink` with zero sim stalls and 80 writes for 40 frames.
- `packages/ble/src/index.ts` (additive, orchestrator-approved): exports `streamBleRendererFrame`, `BleFrameFeedback`, `BleStreamedFrame`. Diff is additions only.

## Proof (scoped, mid-flight allowed)

- `yarn workspace @autolight/ble test src/stream.test.ts`: 5 passed.
- `yarn workspace @autolight/ble test` (full): 10 files, 59 tests passed.
- `yarn workspace @autolight/ble typecheck`: clean.
- `yarn workspace @autolight/ble build` plus node import of `dist/index.js`: new barrel symbols resolve.

## Delete test

Delete `streamBleRendererFrame`: stream tests fail to import. Return `effectiveFps: budgetHz` regardless of distinct colours and the reporting test goes red (expects 10 at 2 colours on a 20 Hz budget). Encode blackout as `blePower(false)` and the blackout test goes red (expects 0x33 0x05).

## Seams

- Planning seam (`planBleFrame`, `encodeBleStreamFrame`) owned with BleFullStack T-BLE-04; extended additively, never rewritten.
- Renderer feed shape (`Uint8Array` zone triples) matches `renderFrame` per-fixture output; renderer capability (`capabilityForFixture` ble-segmented) is the consumer of the feedback, wired outside this task.
- HW runbook (two-colour chase against owner units) outstanding. Sim runs prove code, never hardware.
