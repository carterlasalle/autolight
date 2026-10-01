# T-BLE-01: BLE backends and placement (DS-04)

Closes F-BLE-01 (backend part). Spec: WP04 T-BLE-01, DS-04, config `govee.ble.backend`.

## What changed

New package `@autolight/ble` (`packages/ble/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts` barrel; scaffold owned by this slice, see yield note on follow-up slices).

- `src/constants.ts` (new): GATT UUIDs, frame markers, command codes, flag bit `0x40`, defaults mirrored from config keys. Read-only protocol invariants.
- `src/backends.ts` (new): `BleAdapter` seam, `BackendSelector` DS-04 switch (`toolkit-ble`, `noble`, `auto`), per-device override with typed reason, scan retry on the other backend, `placeBleBackend` (worker thread, utility process, main with latest-wins bridge), `LatestWinsChannel`.
- `src/backends.test.ts` (new): 7 tests, all failing-capable (auto picks toolkit, auto falls back with typed reason, toolkit mode throws instead of silent downgrade, per-device fallback, placement, bridge depth, scan retry).
- `src/sim.ts` (new, shared seam): `SimPeripheral` plus `SimBleAdapter` for both backend kinds; used by T-BLE-01 to T-BLE-04 tests. T-BLE-09 owns the full simulator; this file is the minimal seam and follow-up extends it.

Did not touch: `src/permissions.ts` (NetTrustBle, T-BLE-08), `docs/finish/STATUS.md`, `tools/ratchet.json`.

## Proof commands (orchestrator runs at phase end)

- `yarn workspace @autolight/ble test`
- `yarn workspace @autolight/ble typecheck`

Not run mid-flight per wave contract (siblings edit concurrently). No pass claimed here.

## Delete test

Delete `src/backends.ts`: all 7 tests fail to import. Make `createBackendSelector` downgrade silently in `toolkit-ble` mode and the `rejects.toBeInstanceOf(BleBackendLoadFailure)` assertion goes red. Skip `noteFallback` on per-device failure and the `decision("BAD:01").reason` assertion goes red.

## Remaining seams

- Real toolkit-ble and noble adapters are not implemented (no hardware on this machine); fakes and the sim stand in. HW runbook (owner units) outstanding.
- Placement capabilities (`workerBleOk`, `utilityBleOk`) must be set by a live capability check in the host; values here are inputs, not measurements.
- Follow-up slices T-BLE-05/06/07/09/10 extend `stream.ts`, `encrypted.ts`, `sim.ts`, `provisioning.ts`; this slice owns the scaffold plus T-BLE-01 to T-BLE-04 files only.
