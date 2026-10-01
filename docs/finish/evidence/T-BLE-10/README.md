# T-BLE-10: BLE Wi-Fi provisioning helper

Closes F-BLE-01, F-BLE-05 (campus and venue networks). Spec: WP04 T-BLE-10.

## What changed

- `packages/ble/src/provisioning.ts` (additive): `provisionBleWifi` Setup flow over the existing frame builders (`bleProvisionStart`, `bleProvisionChunk(s)`, `bleProvisionStop`): `33 17 01`, 3 s wait (`BLE_PROVISION_START_WAIT_MS`), chunked `A1 11` transfer at 300 ms pacing (`BLE_PROVISION_CHUNK_PACING_MS`), `33 17 00`. Payload is utf8 SSID, one NUL, utf8 password (`bleProvisionPayload`). The password lives in a local only for the transfer; it is never stored unless the owner opts in through `onPasswordSaved` (wired to safeStorage outside this package). Result carries the plaintext warning for the pre-transfer UI. Transport (`write`, `sleep`) is injected so tests script timing without real timers.
- `packages/ble/src/provisioning.test.ts` (new): 3 tests. Payload encoding, full flow against the sim (start/cmd, chunk markers, pacing sleeps, received bytes match, `provisionComplete`), opt-in storage versus default never-stored plus bad pacing rejection.
- `packages/ble/src/index.ts` (additive, orchestrator-approved): exports flow, payload, timing and transport symbols. Diff is additions only.

## Proof (scoped, mid-flight allowed)

- `yarn workspace @autolight/ble test src/provisioning.test.ts`: 3 passed.
- `yarn workspace @autolight/ble test` (full): 10 files, 59 tests passed.
- `yarn workspace @autolight/ble typecheck`: clean.

## Delete test

Delete `provisionBleWifi`: provisioning tests fail to import. Skip the `33 17 00` stop write and the flow test goes red (expects start 0x01 first, stop 0x00 last, `provisionComplete` true). Store the password without `onPasswordSaved` and the opt-in test goes red (expects `passwordStored` false by default).

## Seams

- Frame builders (`33 17 01`, `A1 11`, `33 17 00`, chunk split, plaintext warning) owned with T-BLE-04; the flow only sequences them.
- Sim transfer surface (`provisioned`, `simProvisionBytes`, `provisionComplete`) owned by T-BLE-09 sim.
- safeStorage wiring for the opt-in save belongs outside this package (T-SEC-01). HW runbook (travel-router venue move against an owner unit) outstanding.
