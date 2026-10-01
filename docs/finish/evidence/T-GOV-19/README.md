# T-GOV-19: Device metrics

Closes F-GOV-29. Spec 99, 107, 131. Merges the counters the engines
already keep (T-GOV-03/08) with read-back RTT (T-GOV-07) and manager
health (T-GOV-06) into one row per device.

## What was built

- `packages/govee/src/metrics.ts` (new): `DeviceMetrics` with `record()`
  (frame counters accumulate, fps/health/transport/engine gauges replace),
  RTT recording that stamps `lastResponseAtMs` only on a real reply,
  `recordReconnect()` / `markOffline()`, and `snapshot()` /
  `snapshotAll()` returning copies for Devices, Diagnostics and the
  session recorder.
- Re-exported from `packages/govee/src/index.ts`.

## What passes today vs what waits

- Passes today: 3 tests in `packages/govee/src/metrics.test.ts`
  (counters accumulate and gauges replace; null RTT keeps the last stamp;
  reconnects count, offline marks, snapshots are copies).
- Waits on the consumers: wiring engine counters and read-back RTT into
  `record()` per device, and the Devices/Diagnostics/session-recorder
  surfaces (T-UI-08/10, T-DATA-06).

## Proof

- `yarn workspace @autolight/govee vitest run src/metrics.test.ts` :
  3 tests passed; full govee slice run : 40 tests passed.
- `yarn workspace @autolight/govee tsc --noEmit -p tsconfig.json` : clean.
- Red run: replace accumulation with assignment and the counter test goes
  red; stamp on null RTT and the timestamp test goes red; return live
  rows and the copy test goes red.

## Delete test

Delete `packages/govee/src/metrics.ts` and every metrics test fails to
import. Remove the reconnect counter and the reconnect test goes red.
