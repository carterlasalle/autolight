# T-BLE-03: Link manager and pacing

Closes F-BLE-01, F-BLE-02 (link and budget part). Spec: WP04 T-BLE-03, config `govee.ble.writeBudgetHzDefault`, `govee.ble.writeDrainMsDefault`.

## What changed

- `packages/ble/src/link.ts` (new): `BleLink`, one link per device. Reconnect with backoff, advertising-gap tolerance, notify subscription (reattached on reconnect), pacing against the unit measured budget (default with `unmeasured` badge), drain hold before intentional disconnect, newest-state-wins (unsent write replaced, counted), burst guard (emits at most one write per spacing interval, so catch-up never exceeds the budget). Injected clock, no real timers.
- `packages/ble/src/link.test.ts` (new): 5 tests, all failing-capable (paced burst never stalls the sim, default budget carries the unmeasured badge, newest-wins replacement, drain hold, gap-triggered reconnect with backoff).
- `packages/ble/src/e2e.test.ts` (new, shared): end to end select/scan/bind/pace/stream of a two-colour chase at 20 fps budget; asserts 80 writes, zero sim stalls, one-connection rule.

## Proof commands (orchestrator runs at phase end)

- `yarn workspace @autolight/ble test`
- `yarn workspace @autolight/ble typecheck`

Not run mid-flight per wave contract. No pass claimed here.

## Delete test

Delete `src/link.ts`: link and e2e tests fail to import. Remove the spacing gate in `pump` and the paced-burst test goes red (the sim records stalls). Remove the drain wait in `close` and the hold test goes red. Skip `attachNotify` on reconnect and notify stops after a gap reconnect.

## Remaining seams

- Budget numbers come from the T-BLE-06 wizard per unit; until then the default plus badge applies.
- HW runbook (owner units, measured budget/ceiling/recovery) outstanding. Sim runs prove code, never hardware.
