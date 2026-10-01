# T-TRU-08: Mutation testing

Closes F-QA-08, F-QA-14, scar S2.

## What changed

- `tools/mutation/critical.json` (new): the safety-critical list enforced by
  name. 40 entries under 11 safety items: blackout path (5: handler,
  translate, render, payload, transport), razer/BLE encoders and checksums
  (6: encode, envelope, paint, zoned, plus two `pending` BLE entries owned by
  T-BLE-04), arm/disarm (2), no-power-cycle and no-kelvin (4), beat mapping
  both directions (4), seek (2), crossfader weight (3), impact owner (3),
  restraint budgets (3), config validator (3), IPC validators (5). Every entry
  names a module path plus a symbol; the checker fails on any module that
  does not exist or any entry still `pending`.
- `tools/mutation/check-critical.mjs` (new): the checker. Exits nonzero when
  a `present` entry names a missing module, or when any `pending` entry
  remains. Runs in the `mutation-fast` job (every push) and the
  `mutation-full` job (nightly).
- Root devDeps (hand-added entries for the orchestrator to install):
  `@stryker-mutator/core`, `@stryker-mutator/vitest-runner`,
  `@stryker-mutator/typescript-checker` at `^10.0.0`. Inline Stryker configs
  are generated per package in CI because no committed config exists yet;
  thresholds high/low/break all 85.
- `mutation-fast` (CI, changed files): Stryker on changed TS packages in the
  nine mutation-scope modules (base from the PR head, `HEAD~1` fallback),
  then the critical-list check, then mutmut on changed Python modules.
- `mutation-full` (nightly): Stryker across all nine modules plus `mutmut run`
  over events, structure, fusion, features, stems, plus the critical-list
  check.

## Proof

- `node -e` over `tools/mutation/critical.json`: 40 entries, 11 unique
  safety items, every named safety item covered (blackout path, razer/BLE
  encoders and checksums, arm/disarm, no-power-cycle and no-kelvin, beat
  mapping both directions, seek, crossfader weight, impact owner, restraint
  budgets, config validator, IPC validators).
- `node tools/mutation/check-critical.mjs` today: exits 1 naming
  `ble-encode, ble-checksum` as pending under T-BLE-04. That is the intended
  red run: the enforcement gate exists and fails visibly until the BLE codec
  owner lands the two symbols.
- The zero-survivor policy and the 85 floor are recorded in
  `critical.json` (`policy`, `floor`); per-module floors in `moduleFloors`
  each name the task that raises the module to 85 (for example T-GOV-02 for
  the razer codec).

## Delete test

Remove one `present` entry's module from disk (or rename) and the checker
exits 1 naming it. Mark a listed symbol `pending` and the checker exits 1
naming the owning task. Add a surviving mutant to a listed symbol and the
nightly run flags it by name.
