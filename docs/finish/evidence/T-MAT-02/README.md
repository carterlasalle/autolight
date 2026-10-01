# T-MAT-02: Matter control mapping

Closes F-MAT-01 (control part). Verified on the simulator only: no claim is
made about a physical light rendering these commands. Simulator runs prove
code, never hardware.

## What was built

- `packages/matter/src/mapping.ts` (new):
  - `rgbToHsl254`: RGB to hue/saturation/level in Matter 0..254 units.
    Pure red maps to hue 0, full saturation, full level; pure green to hue
    85; mid grey to zero saturation.
  - `toMatterWrites`: one show-time frame to Matter writes. Black maps to a
    single `onOff/off` write (the node keeps its level, so the next On
    restores it). Every other frame is On plus `levelControl/moveToLevel`
    plus `colorControl/moveToHueAndSaturation`, each carrying
    `transitionDs: 0` (transition time 0, tenths of a second, for show use).
    No show-time frame ever emits `moveToColorTemperature`; colour
    temperature is a separate setup-only path.
  - `cctToMatterSetupWrites`: setup-only Kelvin to mireds (clamped to the
    Matter 147..652 range) plus level. 2700 K maps to 370 mireds.
  - `minIntervalMs`: the pacing math for `govee.matter.commandRateHz`
    (default 10 Hz, registry key already exists with an `unmeasured`
    receipt): 10 Hz is 100 ms spacing, 20 Hz is 50 ms.
- Capability is whole fixture only, matching the DS-31 `matter-basic` row.
  Matter never carries a segment stream.

## Rate measurement

`measurement.json` records this session's numbers: `minIntervalMs(10)` is
100 ms by construction, and a 1000 iteration `setTimeout(0)` loop on this
machine took 1134.5 ms (about 1.1 ms per tick), so the 100 ms command
spacing dominates timer jitter by two orders of magnitude. Sustainable
per-device radio rate is unmeasured and waits on hardware; the registry
receipt for `govee.matter.commandRateHz` stays `unmeasured`.

## What passes today vs what waits

- Passes today: 8 tests in `packages/matter/src/mapping.test.ts`: red
  maps to On/level 254/hue 0/saturation 254, black maps to a single Off,
  no frame in a three colour sweep emits `moveToColorTemperature`, 2700 K
  maps to 370 mireds with full level, and the pacing math pins 10 Hz to
  100 ms.
- Waits on hardware: the sustainable command rate per device measured
  against a real light, which replaces the `unmeasured` receipt.

## Proof

- `vitest run --root packages/matter`: 4 files, 26 tests passed (see
  `green-run.txt`).
- `tsc --noEmit -p packages/matter/tsconfig.json`: clean.
- Red run: replacing `transitionDs: 0` with `transitionDs: 50` in
  `mapping.ts` fails 2 tests (`red-run.txt`). The zero-transition show
  requirement is what the tests pin.

## Delete test

Delete `packages/matter/src/mapping.ts` and `mapping.test.ts` fails to
import. Change the black branch to emit On and the black test goes red.
Add a CCT write to `toMatterWrites` and the sweep test goes red.

## Remaining seams

- The pacer that enforces `minIntervalMs` between adapter commands lives
  with the failover/transport wiring (T-FOV-01), which owns per-device
  send pacing.
