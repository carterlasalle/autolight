# T-TRU-08: Mutation testing

Closes F-QA-08, F-QA-14 (mutation part).

## What changed

- `tools/mutation/critical.json`: 40 safety-critical entries across 14
  modules (blackout path handler/translate/render/payload/transport, razer
  encoders plus checksums, arm/disarm lifecycle, no-power-cycle and
  no-kelvin invariants, beat mapping both directions, seek detection,
  crossfader weight, impact owner, restraint budgets, config validator, IPC
  validators). Two BLE entries are `pending` owned by T-BLE-04 (no BLE
  transport yet); `check-critical.mjs` fails while any entry is pending, so
  the gate stays honestly red until M2.
- `tools/mutation/check-critical.mjs`: fails on missing modules or pending
  entries; CI `mutation-fast` runs it plus Stryker on changed packages
  (floor 85) and mutmut on changed Python modules.
- Nightly workflow runs the full Stryker sweep plus mutmut, fuzzing,
  timing, and the 4h SIM soak.

## Proof

- `node tools/mutation/check-critical.mjs` exits 1 today naming the two
  T-BLE-04 pending entries (honestly red, not waived).
- Stryker and mutmut devDeps pinned in root package.json
  (@stryker-mutator/core, typescript-checker, vitest-runner).
- Floor 85 matches the finish plan (AGENTS.md says 75; the finish round
  raises it per the briefing).

## Delete test

Delete any critical entry and the module loses its zero-survivor guard.
Resolve the BLE entries early and the checker goes green prematurely,
hiding the missing transport, so they stay pending until T-BLE-04 lands.
