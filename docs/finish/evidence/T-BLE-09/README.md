# T-BLE-09: BLE simulator

Closes F-BLE-01, F-QA-12 (BLE part). Spec: WP04 T-BLE-09.

## What changed

- `packages/ble/src/sim.ts` (additive): the T-BLE-01 to T-BLE-04 peripheral is now the full sim behind the backend adapter seam. Added: GATT version byte on `...2b12` (`readVersionByte`, `simGattState`), short `0xA5` host colour handling with `renderHoldMs` expiry (`hostColorHeld`, `simHostColorExpired`), toolkit seed handshake (`handshakeSeed`, E7 01 then E7 02, `handshakeDone`), v2 handshake (`v2Key`, E7 11 01, SKU plus MAC `readV2ReplyText`), provisioning transfer (`33 17` start/stop plus `A1 11` chunk bytes, `provisioned`, `simProvisionBytes`, `provisionComplete`), family sweep builder (`simFamilyPeripherals`: all six WP04 name families with encoded flag on gv, pactType/pactCode, version bytes), contract checks (`simContractChecks`: families, one-connection rule, version characteristic, hold queryable). Budget stall, one-connection rule, masked writes, acks and reads unchanged.
- `packages/ble/src/sim.test.ts` (new): 7 tests. Family sweep with flag and pact bytes, ack plus LSB-first masked writes, budget stall plus one-connection enforcement, GATT version state, host colour hold/expiry, provisioning bytes in order, full contract pass.
- `packages/ble/src/index.ts` (additive, orchestrator-approved): exports family, contract, GATT, hold and provision symbols. Diff is additions only.

## Proof (scoped, mid-flight allowed)

- `yarn workspace @autolight/ble test src/sim.test.ts`: 7 passed.
- `yarn workspace @autolight/ble test` (full): 10 files, 59 tests passed.
- `yarn workspace @autolight/ble typecheck`: clean.

## Delete test

Delete `simFamilyPeripherals`: sim and qualify tests fail to import. Remove the `0xA5` branch in `handleWrite` and the hold test goes red (paints never land). Accept `0xE7` without answering and the encrypted handshake test goes red (no `handshakeDone`).

## Seams

- Peripheral core (connect, notify, budget stall, masked writes) owned with BleFullStack T-BLE-01 to T-BLE-04; extended additively, never rewritten.
- Consumers: every BLE probe runs here (stream T-BLE-05, qualification T-BLE-06, encrypted T-BLE-07, provisioning T-BLE-10, link T-BLE-03, e2e). Contract tests are the CI gate.
- Hardware claims still need owner units; this sim proves code, never hardware.
