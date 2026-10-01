# T-GOV-12: IDENTIFY, TEST CHASE, RECALIBRATE, identify walk

Closes F-GOV-10. Spec 99. Builds on T-GOV-10 (probe verdicts decide the mode)
and T-GOV-11 (the wizard RECALIBRATE opens into).

## What was built

- `packages/govee/src/actions.ts` (new): the four device actions as typed
  functions that send real datagrams through the shared transport.
  - `identify()`: captures the observed state with a short `devStatus`
    read-back (an armed or absent unit does not stall a user action), then
    flashes full white for `govee.identify.flashMs` and restores the previous
    look. Through the armed stream it paints a white B0 frame and then the
    current show frame (`restored: "current-frame"`), or stream RGB zeros when
    there is no frame yet (`"blackout-frame"`). Unarmed it uses
    `colorwc` RGB white and restores what the unit reported
    (`"observed-state"`), or says `"no-read-back"` when nothing answered.
    Never `turn` while armed and never a white `colorwc` while armed, because
    either can end the channel.
  - `testChase()`: walks one zone from the venue start end to the other and
    back at `govee.testChase.stepMs`, at the qualified resolution, through the
    stream. The fixture's qualified orientation decides which index is the
    start. A verified single-zone fixture gets a three-step RGB brightness ramp
    instead (spec 49), because there are no zones to walk.
  - `chaseFrames()` (exported, pure): the exact frames the chase sends, so the
    bytes can be asserted without a transport.
  - `recalibrate()`: takes anything with `enterAt(step)` (structurally the
    wizard) and returns the typed intent, so the device screen can show which
    step the user landed on. The wizard keeps the state; this is not an echo of
    the request, it changes the wizard's current step.
  - `identifyWalk()`: lights each unit in turn in the order given (venue
    order), with an optional pause between units for the user to name and
    place them, and returns the order plus each unit's identify result.
- The recording fake in `packages/govee/src/lan-fake.test-support.ts` records
  every `sendRaw` and `sendJson`, and the test-side `goldenHex()` encoder
  builds the expected bytes independently of the production codec, so the
  assertions are golden vectors rather than a re-run of the same encoder.

## What passes today vs what waits

- Passes today: 7 tests in `packages/govee/src/actions.test.ts`.
  1. IDENTIFY while armed: exactly the white B0 frame then the current show
     frame, no turn and no white `colorwc`, channel still armed.
  2. IDENTIFY while unarmed: `devStatus` capture, white `colorwc`, then the
     observed brightness and colour restored, byte exact.
  3. TEST CHASE segmented: eight frames, forward then reverse, exact bytes and
     the zone travel the fake unit actually rendered (`[0,1,2,3,3,2,1,0]`).
  4. TEST CHASE single-zone unarmed: the three-step ramp `136, 202, 255` in RGB
     through `colorwc`.
  5. TEST CHASE single-zone armed: the same ramp as stream frames, because a
     `colorwc` while armed can end the channel.
  6. RECALIBRATE: opens the wizard at step 13 (`stable-rate`), the step is
     pending, the state is in progress.
  7. identify walk: two units lit in the given order, each unit receiving only
     its own four commands, with the pauses recorded.
- Waits on the UI: the device screen path of `P-99-device-actions` is proven in
  `T-UI-08`, which calls these functions through the typed IPC. This module is
  deliberately UI-free: no DOM, no IPC, no timers beyond the wait it is given.
- Waits on hardware: no claim is made about any unit. `HW-GOV-06` (IDENTIFY,
  TEST CHASE, RECALIBRATE, identify walk on real units) is the owner's runbook
  and is referenced here, not claimed.

## Proof

- `cd packages/govee && npx vitest run src/actions.test.ts` : 1 file, 7 tests
  passed (about 0.3 s).
- `cd packages/govee && npx vitest run src/profiles.test.ts src/probe.test.ts
  src/actions.test.ts src/qualification.test.ts` : 4 files, 25 tests passed,
  run repeatedly, stable.
- `cd packages/govee && npx tsc --noEmit -p tsconfig.json` : no output (clean).
- Red run: the file imports modules that do not exist at HEAD, so it cannot
  pass there. At behaviour level, sending the flash through `colorwc` while
  armed makes the armed test red (wrong bytes and a channel that ends); using
  the observed state instead of the current frame in the armed path makes the
  restore assertion red; reversing the chase direction list makes the
  `zoneOrder` assertion red; replacing the single-zone ramp with one colour
  makes the ramp assertion red; making `recalibrate()` an echo that does not
  call `enterAt` makes the wizard-step assertions red.

## Delete test

Delete `packages/govee/src/actions.ts` and the action tests plus the wizard
test file fail to import (step 2 of the wizard calls `identify`). Change the
white flash payload in `identify` and the two byte assertions go red. Drop the
`fixture.armed` branch and the armed test's frame list goes red. Drop the
`pause` call in `identifyWalk` and the pause assertion goes red. Make
`testChase` ignore `fixture.orientation` and the direction assertion for a
reverse fixture stays green but the orientation test in the wizard file goes
red, which is why the orientation decision is recorded per unit in step 11.
