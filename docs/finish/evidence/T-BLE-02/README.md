# T-BLE-02: Scan and identity binding

Closes F-BLE-01, F-BLE-04, F-BLE-02 (identity part). Spec: WP04 T-BLE-02.

## What changed

- `packages/ble/src/scan.ts` (new): `parseBleAdvertisement` (name family, encoded flag bit `0x40`, pactType, pactCode read live on every scan), `nameFamilyOf` (`GBK_`, `GV`, `ihoment_`, `Govee_`, `Minger_`, unknown), Bluetooth scan entries distinct from LAN entries, `BLE_NOT_ADVERTISING_GUIDANCE` for expected-but-silent devices, `bindBleToLan` (binds only on `aa 14` Wi-Fi MAC match or explicit user confirmation after BLE identify flash; throws otherwise, so SKU/name/suffix merges are never taken), `normalizeMac`.
- `packages/ble/src/scan.test.ts` (new): 7 tests, all failing-capable (every name family, live flag/pact bytes, Bluetooth entry kind, missing-device guidance, MAC match across formats, identify-confirmed binding, refusal to merge).

## Proof commands (orchestrator runs at phase end)

- `yarn workspace @autolight/ble test`
- `yarn workspace @autolight/ble typecheck`

Not run mid-flight per wave contract. No pass claimed here.

## Delete test

Delete `src/scan.ts`: all 7 tests fail to import. Remove the throw in `bindBleToLan` and both refusal tests go red (a mismatched MAC pair and a no-confirmation pair would bind). Drop the `0x40` check and the encoded-flag test goes red.

## Remaining seams

- The `aa 14` read and the BLE identify flash live in the link/command layer; binding takes their outputs as inputs.
- HW runbook (owner units, real advertisements) outstanding. Sim runs prove code, never hardware.
