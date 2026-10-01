# T-FOV-01: Transport model and policy (DS-03)

Closes F-GOV-18, spec 148. Probe `P-148-ladder`.

## What was built

- `packages/failover/` (new package `@autolight/failover`):
  `src/transports.ts` replaces the misnamed
  `LanTransport = "lan" | "ble" | "cloud"` with the six-transport union
  `lan-razer`, `lan-json`, `ble-segmented`, `ble-single`, `matter`,
  `cloud-metadata`. Each fixture carries an ordered list of enabled
  transports (`govee.device.<fixtureId>.transportOrder`, default
  `["lan-razer","ble-segmented","lan-json","ble-single","matter"]`) plus a
  verified capability record per transport from qualification. Policy
  `govee.failover.policy` (DS-03): `strict` pins the first transport and
  never switches, `auto` takes the best verified transport at the moment,
  `hybrid` (default) routes segment frames only to verified segmented
  transports and allows whole-fixture fallback with a visible banner. Cloud
  never carries frames and never serves beat-critical use.
- All eight per-device modes (DS-31: `auto`, `hybrid`, `lan-segmented`,
  `lan-basic`, `ble-segmented`, `ble-basic`, `matter-basic`, `cloud-basic`)
  resolve through one pure selector. Explicit single-transport modes pin and
  are never overridden (the toolkit strict stance: no silent switching). A
  mode the fixture never qualified for reports disabled with the reason
  ("BLE not qualified on this unit"). `cloud-basic` authorises only outside
  Live with `security.cloudAllowed` true; `routeFrame` proves which
  transport carried the bytes and throws when nothing is selected so a dark
  fixture never sends.

## What passes today vs what waits

- Passes today: 15 tests in `packages/failover/src/transports.test.ts`:
  the P-148 ladder (LAN blocked to BLE segmented; both blocked to
  whole-fixture LAN JSON or Matter; dark with banner when all are down;
  cloud never routed under any policy), all eight modes carrying bytes on
  the pinned transport via `routeFrame`, strict never switching, and mode
  availability reasons. The dropdown and tile surface is UI work outside
  this slice.
- Waits on T-FOV-03 (capability-aware rendering for the degraded classes
  this selector reports) and on BLE/Matter qualification (T-BLE-06,
  T-MAT-02) for real verified records; tests here use scripted status maps.

## Proof

- `yarn workspace @autolight/failover test`: 2 files, 26 tests passed
  (15 transport plus 11 machine).
- `yarn workspace @autolight/failover typecheck`: clean.
- Red runs: pointing hybrid at whole-fixture first makes 9 tests red
  (ladder holds, hybrid frame class, Matter fallback, machine Matter case).

## Delete test

Delete `packages/failover/src/transports.ts` and both test files fail to
import. Remove the `cloud-metadata` skip in `firstUsable` and the
never-cloud test goes red. Remove the strict hold and the strict tests go
red. Remove a `MODE_PINNED` entry and that mode test goes red.

## Remaining seams

- Playwright dropdown-to-tile proof belongs to the UI slice that renders
  `govee.device.<fixtureId>.transportMode`; the selector and availability
  reasons it binds to are done here.
- Renderer capability input (zones, colour budget, rate) is T-FOV-03.
