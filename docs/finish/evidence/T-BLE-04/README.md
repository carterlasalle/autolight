# T-BLE-04: Command set and dialects

Closes F-BLE-01, F-BLE-02 (commands part). Spec: WP04 T-BLE-04.

## What changed

- `packages/ble/src/commands.ts` (new): 20-byte codec (XOR) for `0x33`/`0xAA`/`0xA1`/`0xA3`, short `0xA5` codec (sum), ack parsing (`00` is accepted-not-applied), full WP04 command list (power, brightness with per-family 100/255 scale, single `0d`, masked `15 01`, legacy `02`, masked brightness `15 02`, per-zone `15 03`, interpolation `a3`, all reads, host colour probe/one-colour), `maskForZones` (LSB first), `BleDialect` record plus default.
- `packages/ble/src/stream.ts` (new, shared seam): masked-write planning (largest group first, effective rate `budget / distinctColours`), single-colour fast path (host colour when qualified), masked blackout (never power off). T-BLE-05 owns the renderer feed; this file is the planning seam and follow-up extends it.
- `packages/ble/src/encrypted.ts` (new, detect only): `encryptedLinkNeed` (flag bit / v2 byte / DS-05 mode) plus the keys-needed UI copy. Key material and AES-GCM belong to T-BLE-07, not here.
- `packages/ble/src/provisioning.ts` (new, frame builders): `33 17 01`, `A1 11` chunks, `33 17 00`, plaintext warning. The transfer flow belongs to T-BLE-10, not here.
- `packages/ble/src/commands.test.ts` (new): 13 tests, all failing-capable, goldens from the independent `simGoldenFrame` encoder (never the production codec).

## Proof commands (orchestrator runs at phase end)

- `yarn workspace @autolight/ble test`
- `yarn workspace @autolight/ble typecheck`

Not run mid-flight per wave contract. No pass claimed here.

## Delete test

Delete `src/commands.ts`: command and e2e tests fail to import. Flip the XOR to a sum and every golden goes red. Change masked kind `01` to `02` and the masked golden goes red. Accept a nonzero ack status as applied and the ack test goes red.

## Remaining seams

- Dialect values are recorded per device by qualification (T-BLE-06); defaults assume single-colour only.
- HW runbook (golden vectors against owner units) outstanding. Sim runs prove code, never hardware.
