# T-GOV-17: Unknown firmware policy

Closes F-GOV-21. Spec 147. Consumes the T-GOV-11 `noteFirmware` gate
(steps 8, 9, 12, 13 before segmented resumes); the wizard owns the gate,
this owns the run-time policy around it.

## What was built

- `packages/govee/src/firmware.ts` (new): `FirmwarePolicy.decide()`
  (known firmware plus verified channel keeps segmented; unknown firmware
  gates to the verified fallback with a REQUALIFICATION REQUIRED warning
  naming both versions; unreadable firmware keeps control but warns) and
  `mayRearm()` (a failing raw stream gets at most
  `govee.lan.stream.maxRearmAttempts` re-arms per
  `govee.lan.stream.rearmWindowMs`, default 3 per 60 s).
- Re-exported from `packages/govee/src/index.ts`.

## What passes today vs what waits

- Passes today: 4 tests in `packages/govee/src/firmware.test.ts` (known
  keeps segmented; unknown gates loudly; unmeasured keeps but warns;
  the fourth re-arm inside the window is refused and the window slides).
- Waits on the registry: persisting the warning per device and running the
  background checks while the show is idle (T-GOV-06); waits on the UI:
  the diagnostic warning (T-UI-10).

## Proof

- `yarn workspace @autolight/govee vitest run src/firmware.test.ts` :
  4 tests passed; full govee slice run : 40 tests passed.
- `yarn workspace @autolight/govee tsc --noEmit -p tsconfig.json` : clean.
- Red run: return segmented for unknown firmware and the gate test goes
  red; drop the window eviction and the re-arm test goes red.

## Delete test

Delete `packages/govee/src/firmware.ts` and every firmware test fails to
import. Remove the `maxRearmAttempts` cap and the re-arm test goes red.
