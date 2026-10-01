# T-GOV-10: Capability probe and verified fallback

Closes F-GOV-04, F-GOV-24, F-X-09. Spec 42, 147, 153. Builds on T-GOV-14
(byte-exact recording transport) and the T-GOV-02 codec seam.

## What was built

- `packages/govee/src/probe.ts` (new): the per-unit capability probe and the
  visible fallback states.
  - `probeSegmentedCapability()` runs the step-8 sequence of spec 52 against one
    unit: `status`, arm, wait the unit's settle, `status` again for the B2
    armed bit (silence while armed is recorded, never treated as failure), a
    known two-colour B0 paint, and the B4 zoned probe. Paints never
    acknowledge, so the user is the oracle: `ProbeUser.confirmPaint` is called
    for B0 and B4.
  - Verdicts are typed and never silent successes: `segmented` (verified, with
    the zone count that was painted and whether B4 answered),
    `single-zone-fallback` (verified false, degraded true, visible badge
    `SINGLE-ZONE (fallback)`, reason `paint-ignored` when the unit reported the
    channel armed but the user saw one colour, fallback mode `lan-json-colorwc`
    which is the mode this unit did verify by read-back) and `lan-unavailable`
    (badge `LAN unavailable on this firmware`, BLE `ble-segmented` offered as
    the alternative, plus the T-GOV-16 SignalRGB checklist).
  - Every datagram the probe sends is kept as a hex or JSON receipt on the
    result (`framesSentHex`, `commandsSent`), and commands are spaced by
    `CommandSequencer` (`govee.lan.command.minSpacingMs`) because three
    datagrams back to back lose the third.
  - `readB2Status` and `readDevStatus` resend at `govee.lan.status.retryMs`
    until a reply or `govee.lan.status.deadlineMs`, and keep the resend
    cadence even when a transport answers null immediately.
  - `DeviceLink` is the shared send path the wizard and the actions use; it
    records the exact bytes sent.
- The old claim is gone from this slice: no caller of this module may assume a
  segmented channel, and the fallback is a degraded state with a badge, not a
  success. The literal "single-zone over LAN" wording in `index.ts` and
  `apps/desktop/electron/govee-lan.ts` (`collapseToSingleColor`, `frameToLan`)
  is outside this slice: `index.ts` belongs to the manager task and the desktop
  path to the UI tasks. The probe verdict is the replacement input for both.

## What passes today vs what waits

- Passes today: 25 tests in four new files (probe 5, qualification 8, actions
  7, profiles 5). `probe.test.ts` covers the three simulated firmware
  behaviours T-GOV-10's definition of done names:
  1. segmented works: verdict `segmented`, B2 armed read-back, user
     confirmation, and the exact arm / two-colour B0 / B4 / disarm frames.
  2. segmented silently ignored: arm accepted, B2 reported armed, paint
     swallowed, verdict `single-zone-fallback` with `paint-ignored` and the
     badge.
  3. LAN absent: no reply at all, zero razer frames sent, verdict
     `lan-unavailable` with the BLE alternative and the troubleshooting list.
  A fourth test pins the toolkit trap that a unit may stay silent while armed
  and that this is not a failure.
- Waits on hardware: no claim is made about H6076 or H1A45. Simulator and fake
  runs prove code, never hardware. `HW-GOV-02` (razer capability probe per
  unit) is the runbook the owner runs; it is referenced here, not claimed.
- Waits on the manager: the probe is not yet called from `index.ts` (owned by
  the manager task, which also removes `collapseToSingleColor`), and the
  three firmware behaviours are modelled at datagram level in
  `packages/govee/src/lan-fake.test-support.ts` because `GoveeLanSim` has no
  "arm accepted, paint ignored" fault today; adding that fault to the
  simulator is not in this slice's owned paths and was reported to Main.

## Proof

- `cd packages/govee && npx vitest run src/probe.test.ts` : 1 file, 5 tests
  passed.
- `cd packages/govee && npx vitest run src/profiles.test.ts src/probe.test.ts
  src/actions.test.ts src/qualification.test.ts` : 4 files, 25 tests passed
  (run repeatedly, stable).
- `cd packages/govee && npx tsc --noEmit -p tsconfig.json` : no output (clean).
- `npx ast-grep scan --config tools/ast-grep/sgconfig.yml packages/govee/src/...`
  on the new files: exit 0, only the documented ratchet-baseline numeric
  warnings (the same class the existing codec carries).
- Red run: the four test files import modules that do not exist at HEAD, so
  they cannot pass there. At behaviour level, the fallback test goes red if the
  verdict branch is removed (a paint-ignoring unit would return `segmented`),
  and the LAN-absent test goes red if the reachability branch is removed (the
  probe would arm and paint a unit that answers nothing, so `framesSentHex`
  would stop being empty).

## Delete test

Delete `packages/govee/src/probe.ts` and all four new test files fail to
import, as does the wizard. Change the two-colour B0 payload in
`twoColourFrame` and the byte assertion in `probe.test.ts` goes red. Make the
probe accept the B4 confirm as proof of the B0 paint and the
`b0Confirmed` assertions go red. Drop the reachability check and the LAN-absent
test goes red; require a parseable reply instead of any reply and the
unparseable-read-back test goes red. Drop the `armedReadBack` recording and the
silent-while-armed test goes red. Remove the `CommandSequencer` call from `DeviceLink.sendRaw` and
`sendJson` and the spacing guard is gone; the frame-order assertions would still
pass, which is why the spacing rule is written down here rather than only
tested.
