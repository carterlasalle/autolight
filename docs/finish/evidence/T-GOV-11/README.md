# T-GOV-11: Qualification wizard runner

Closes F-GOV-11, F-GOV-12, F-GOV-22, F-GOV-24, F-X-07. Spec 52, 53, 54.
Builds on T-GOV-10 (the step-8 probe) and T-GOV-12 (`identify` for step 2).

## What was built

- `packages/govee/src/qualification.ts` (new): all 16 steps of spec 52 as one
  resumable state machine with a typed API (the UI flow over it is T-UI-09).
  - `QUALIFICATION_STEPS` lists the 16 steps in order with the spec section each
    implements: discover, identify, read SKU, read firmware, verify power,
    verify global brightness, verify RGB, verify local RGBIC stream, logical
    segment count, segment order, reverse orientation, arm settle, stable
    output frequency, visual latency, reconnect, save calibration.
  - `QualificationSession.open()` resumes the record for a hardware ID from the
    store, `runStep()` runs exactly one step (the UI's unit of work) and
    persists it, `runAll()` drives the sequence and stops at the first failure,
    `enterAt()` is the RECALIBRATE entry point, and `noteFirmware()` is the
    firmware-change rule.
  - Every step records its own typed evidence: what was sent (hex frames and
    JSON commands through `DeviceLink`), what the unit answered (`devStatus`
    and `status` read-backs with RTT), and what the user confirmed or counted.
    Nothing is filled in when it was not measured: step 14 records
    `method: "unmeasured"` and the calibration lists the field in `unmeasured`
    instead of inventing a number.
  - Step 9 is the spec 42 answer: candidate band counts are painted as a zebra
    stripe pattern and the sweep stops at the first count that does not appear,
    so the changepoint is the unit's own count. No literal 14 and no SKU
    assumption exists in production code.
  - Step 12 sweeps arm settle from 0 to 200 ms in 20 ms steps and records every
    attempt; step 13 sweeps the rate downwards through a real `PacingStream`
    (one-zone chase, supersede and missed-tick counters recorded per rate) and
    the first rate without stutter is `maxStableFps`; step 15 measures re-arm
    and first frame after the user power-cycles the unit.
  - Step 16 writes the spec 54 record (segment count, native count, max stable
    fps, expected latency plus method, arm settle, orientation, gamma,
    brightness ceiling, firmware) together with the capability verdict from
    step 8 and the whole 16-step evidence table.
- Persistence: the whole state is written after every step through
  `CalibrationStore`, which is exactly `@autolight/storage`
  `Store.saveCalibration` / `loadCalibration`. The repo schema currently keeps
  that JSON on the `devices` row (`packages/storage/schema.sql`); the
  `device_calibrations` split is T-GOV-06's registry work, and this module
  needs no change when that lands because the interface is the same shape.
- Firmware change (spec 52): `noteFirmware()` marks `REQUALIFICATION REQUIRED`,
  resets steps 8, 9, 12 and 13 to pending (earlier evidence kept in
  `priorEvidence`, attempt counts kept), and `segmentedResumeAllowed()` returns
  false until those four pass again. Normal control continues on the last
  verified capability meanwhile (spec 147); the key becomes hardware ID plus
  SKU plus the new firmware.
- `MemoryCalibrationStore` (new, exported): the in-memory store for tests and
  for a wizard that has no database yet.

## What passes today vs what waits

- Passes today: 8 tests in `packages/govee/src/qualification.test.ts`.
  1. the full 16-step scripted-user run: all 16 steps pass in order, every step
     has evidence, and the store holds the record keyed by hardware ID plus SKU
     plus firmware.
  2. a unit whose firmware ignores paint: the run stops at step 8, keeps the
     earlier passes, records the visible fallback in the failed step's
     evidence, and saves no calibration.
  3. firmware change: `REQUALIFICATION REQUIRED`, the four required steps back
     to pending, the segmented channel blocked, then a second run to complete.
  4. resume from the store, including a firmware change detected when the
     wizard opens the saved record.
  5. the band-count sweep with byte-exact stripe paints and the changepoint.
  6. RECALIBRATE at step 13: steps 1 to 12 keep their verdicts, 13 to 16 re-run.
  7. firmware key derivation from the scan reply fields, including
     `unmeasured` when the reply carries no version.
  8. a stored record of the wrong shape restarts the wizard at step 1 with the
     reason recorded on the state.
- Waits on hardware: no claim is made about any unit. The scripted virtual user
  answers from what the fake lamp rendered (band counts, landed paints, stutter
  drops) and from scripted confirmations; that proves the state machine, not
  the hardware. `HW-GOV-03` (16-step wizard per unit) is the owner's runbook
  and is referenced here, not claimed; until it is run the per-unit rows stay
  BLOCKED-HARDWARE.
- Waits on other tasks: T-UI-09 owns the wizard UI over this state machine,
  T-GOV-15 owns the logical/grouped/native resolution choice from this record,
  T-GOV-06 owns the registry tables, and T-GOV-17 owns the unknown-firmware
  run-time policy that consumes the `unmeasured` firmware case.

## Proof

- `cd packages/govee && npx vitest run src/qualification.test.ts` : 1 file,
  8 tests passed (about 4 s, real timers).
- `cd packages/govee && npx vitest run src/profiles.test.ts src/probe.test.ts
  src/actions.test.ts src/qualification.test.ts` : 4 files, 25 tests passed,
  run repeatedly, stable.
- `cd packages/govee && npx tsc --noEmit -p tsconfig.json` : no output (clean).
- Red run: the file imports a module that does not exist at HEAD, so it cannot
  pass there. At behaviour level, deleting the `persist()` call makes the
  stored-record assertions red; dropping `REQUIRED_AFTER_FIRMWARE_CHANGE` makes
  the requalification test red; letting step 16 save while an earlier step is
  failed makes the ignore-paint test red; stopping the current-step advance
  makes the step-order assertion red; returning a stripe count instead of the
  user's answer makes the sweep test red.

## Delete test

Delete `packages/govee/src/qualification.ts` and the wizard, action and
recalibrate tests fail to import. Remove the `priorEvidence` push in
`enterAt`/`resetStep` and the history assertions go red. Remove the
`segmentedResumeAllowed()` gate and the firmware-change test's false
assertions go red. Change `firmwareFromScan` to return the SKU instead of the
version fields and the key assertion plus the resume test go red. Remove
`stepSave`'s missing-step check and the ignore-paint test's
`calibration === null` assertion goes red.
