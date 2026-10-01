# T-FOV-02: Failover state machine and the campus scenario

Closes F-BLE-05. Spec 148 with the DS-03 policy from T-FOV-01.

## What was built

- `src/machine.ts` in `packages/failover/`: one `FailoverMachine` per
  fixture. LAN-loss detection per fixture: no status replies and no discovery
  sightings within `govee.failover.lanLossMs` (default 3000) while idle, or
  the stream health signal while armed, marks the LAN path lost. It switches
  per policy, probes the preferred transport every
  `govee.failover.probeIntervalMs` (default 10000), and switches back at a
  bar boundary so the reclaim never pops mid-phrase. Every switch emits a
  `SwitchEvent` (instant, from, to, cause, banner, switchBackAtBar) for the
  log, the device tile, the status bar, and the session recorder.
- `CAMPUS_SEQUENCE`: the canonical campus fault order. Blocked multicast
  alone never fails over (unicast discovery keeps the LAN path alive);
  client isolation (unicast silence past lanLossMs) fails to BLE segmented;
  router restart rides BLE; Wi-Fi drop with BLE out of range falls past BLE
  to whole-fixture Matter; LAN recovery reclaims at the bar boundary only.

## What passes today vs what waits

- Passes today: 11 tests in `packages/failover/src/machine.test.ts`:
  multicast hold then isolation failover with the measured switch instant
  and banner, router restart ride plus bar-boundary reclaim, off-bar hold
  until the bar arrives, Matter fallback when Wi-Fi and BLE are both gone,
  strict riding the outage dark, and the campus sequence order.
- Waits on the UI tile and status-bar binding (banner strings are produced
  here, rendering is the UI slice) and on hardware timing runs for the real
  switch-time numbers.

## Proof

- `yarn workspace @autolight/failover test`: 2 files, 26 tests passed
  (11 machine plus 15 transport).
- `yarn workspace @autolight/failover typecheck`: clean.
- Red runs: via the shared selector, pointing hybrid at whole-fixture first
  makes the Matter fallback test red alongside the ladder tests; holding the
  reclaim off the bar boundary is asserted both ways (off-bar stays on BLE,
  on-bar reclaims LAN), so removing the bar gate flips the hold test red.

## Delete test

Delete `packages/failover/src/machine.ts` and the machine tests fail to
import. Remove the `lanLossMs` silence check and the isolation failover
test goes red. Remove the bar-boundary gate and the hold test goes red.
Remove event emission and the from/to/instant assertions go red.

## Remaining seams

- E2E banner proof (tile plus status bar) belongs to the UI slice; events
  carry everything it needs.
- Measured switch times on hardware belong to the HW runbook, not SIM.
