# T-BLE-06: BLE qualification

Closes F-BLE-01, F-BLE-02 (measurements part). Spec: WP04 T-BLE-06.

## What changed

- `packages/ble/src/qualify.ts` (new): `runBleQualification` wizard in WP04 order: connect, versions (hard/soft), `aa 0f` segment count, `aa 40` IC count, masked-write user verification (records the dialect: single-0d plus masked-15-01 on confirm), write budget benchmark (ascending sweep 10 to 200 Hz against probe sims until the stall, records sustained `writeBudgetHz`, burst ceiling, 2000 ms recovery; null budget stays unmeasured), write drain (write, disconnect, reconnect, read back; records 300 ms), render hold (host colour write plus hold/expiry check), camera latency. Results land in `BleQualificationRecord` with `transport: "ble"` shaped for `device_calibrations`; anything unmeasured stays named in `unmeasured`, never zero-filled. Measurements after the budget sweep run on an advancing clock so the unit budget never contends with wizard writes.
- `packages/ble/src/qualify.test.ts` (new): 4 tests. Blank record honesty, full ordered run on a budget-20 sim (all 9 steps ok, dialect, budget 20 / ceiling 30 / recovery 2000 / drain 300 / hold 2000 / latency 25, empty unmeasured), v2 versus seed handshake reporting with honest unmeasured on denial, full-sim contract gate.
- `packages/ble/src/index.ts` (additive, orchestrator-approved): exports wizard symbols. Diff is additions only.

## Proof (scoped, mid-flight allowed)

- `yarn workspace @autolight/ble test src/qualify.test.ts`: 4 passed.
- `yarn workspace @autolight/ble test` (full): 10 files, 59 tests passed.
- `yarn workspace @autolight/ble typecheck`: clean.

## Delete test

Delete `src/qualify.ts`: qualify tests fail to import. Make `benchmarkWriteBudget` return the ceiling as sustained and the budget test goes red (expects sustained 20, ceiling 30). Confirm masked write without the user and the denial test goes red (expects `maskedWriteVerified` false, dialect single only).

## Seams

- Dialect type (`BleDialect`, `defaultBleDialect`) owned by T-BLE-04 commands; the wizard only fills it per unit.
- Encoded-link classification (`encryptedLinkNeed`) owned by encrypted.ts; the wizard records the outcome, never decides keys.
- Full-sim contract (`simContractChecks`) owned by T-BLE-09 sim; the wizard gates on it.
- HW runbook (wizard against owner units, measured budget/ceiling/recovery/drain/hold/latency) outstanding. Sim runs prove code, never hardware.
