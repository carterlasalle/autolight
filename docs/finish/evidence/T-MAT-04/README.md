# T-MAT-04: Matter simulator

Closes F-MAT-01 (simulator part) and the Matter part of F-QA-12.
Simulator runs prove code, never hardware.

## What was built

- `packages/matter/src/simulator.ts` (new): `startVirtualLight`, a virtual
  colour light behind the `MatterAdapter` seam. It is an `InMemoryAdapter`
  node with the fixed test pairing code `1234-567-8901` (`TEST_PAIRING_CODE`,
  exported so tests and CI use the same value). Commission plus control
  tests observe what the light shows through `nodeState` (on, level, hue,
  saturation). No radio, no ports, no hardware claim.
- `packages/matter/src/simulator.test.ts` (new): 4 tests. The fixed code
  is pinned; a full virtual light commissions with the fixed code and
  applies a red frame to readable state (on, level 254, hue 0, saturation
  254); the full binding flow runs end to end against the virtual light
  (commission, bind with confirmation, vendor id recorded); a wrong pairing
  code is rejected before any node exists.

## What passes today vs what waits

- Passes today: commission plus control of the virtual light in CI with
  the fixed test pairing code, and the binding flow against it.
- Waits on hardware: the CI job commissioning and controlling a real
  light, and the HW runbook for an owner Govee Matter device.
- The matter.js virtual colour light named in the work package is the
  design this simulator follows (on-network commissioning with a fixed
  test pairing code); the in-memory light is used instead because
  matter.js is not a dependency until the T-MAT-01 utility process lands.

## Proof

- `vitest run --root packages/matter`: 4 files, 26 tests passed (see
  `green-run.txt`).
- `tsc --noEmit -p packages/matter/tsconfig.json`: clean.
- Red run: changing `TEST_PAIRING_CODE` fails the pin test
  (`red-run.txt`). Every Matter probe in CI commissions with this value,
  so a drift breaks loudly.

## Delete test

Delete `packages/matter/src/simulator.ts` and `simulator.test.ts` fails
to import. Change the fixed code and the pin test goes red.

## Remaining seams

- Swapping the in-memory light for a matter.js virtual light happens with
  the T-MAT-01 adapter work; the `MatterAdapter` seam keeps the tests
  unchanged.
