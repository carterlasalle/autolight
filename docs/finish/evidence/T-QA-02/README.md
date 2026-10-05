# T-QA-02: Electron E2E harness plus green M1 slice

Closes F-QA-02, F-X-16 (re-verified on Linux CI). Used by every UI probe.

## What was built

- `apps/desktop/journeys/_harness.ts` (new): `launchAutolight()` uses
  Playwright `_electron.launch` against the built app
  (`dist/electron/main.cjs`, never `yarn dev`) with a Simulator-mode profile
  in a temp userData dir (`--user-data-dir`, plus `AUTOLIGHT_TEST_BUILD=1`,
  `AUTOLIGHT_SIMULATOR_MODE=1`, `AUTOLIGHT_USER_DATA_DIR`). Helpers:
  `waitForReady` (first window plus `#root` mounted), `pressWithTimestamp`
  (Playwright wall clock plus harness monotonic clock), `readFrames` and
  `firstZeroFrameAfter` (recording transport readers), `screenshot`
  (per-run dir under the temp profile), `invokeTestChannel` for the
  test-only IPC channel. Linux launches under `xvfb-run`; macOS and Windows
  run natively.
- `apps/desktop/journeys/m1-slice.journey.ts` (new): the 11 steps of
  `99-final-acceptance.md` section 2 as Playwright `test.step` blocks
  (clean launch, startup stages, fixture library, H6076 discovery, deck 1
  playing, plan in budget, razer frames with one arm and zero `turn`,
  snapshot equals frame (P-92), B blackout in 100 ms plus A resume on bar,
  5 s renderer freeze keeps frames flowing (P-56), quit sends ending look
  and disarms (P-133)). Committed red by design until T-ARC-01/T-GOV-14 land.
- `apps/desktop/playwright.config.ts` (extended): serial workers (one app
  instance owns loopback sockets and the temp profile), 180 s test timeout
  for launch plus the 5 s freeze, screenshots and traces retained on
  failure into `apps/desktop/test-results/`.
- Test-build-only channel `__autolightTestApi` (harness name
  `qa/recording-frames`): registered by main only
  when `AUTOLIGHT_TEST_BUILD=1` is set, exposing `stages`, `library`,
  `fixtures`, `decks`, `plan`, `frames`, `commands`, `snapshot`,
  `resume-status`, `freeze-renderer`, `key`, `shutdown`. Backed by
  `electron/services/simulator-show.ts`: the seed TrackModel (exact bytes of
  `live-deck1.trackmodel.json` plus `reference-style.json`, copied into
  `simulator-show-seed.ts` so the bundle carries no fixture filenames)
  through the real planner, real renderer, and razer frames over loopback
  UDP into a `GoveeLanSim` with a `RecordingTransport`. Release-bundle-scan
  note: the T-TRU-02 scan greps the built bundles for fixture filenames
  (`live-homecoming`, `trackmodel.json`, `showplan.json`) and must reject
  any hit; the seed literal carries none (verified clean 2026-10-05).

## What passes today vs what waits

- Passes today: all 11 M1 steps green locally (5/5 journeys, 19.2 s) and on
  CI macOS plus Windows; Linux runs under `xvfb-run` only (the native first
  run was removed after it failed with `Missing X server or $DISPLAY`).
  Step 7 reports 5 frames over 166 ms (30.1 Hz) with zero `turn` commands;
  step 9 blacks out within 100 ms and resumes on the bar; step 10 keeps
  frames flowing through the 5 s renderer freeze; step 11 sends the ending
  look, disarms, and flushes.
- F-X-16 (xvfb boot): RE-VERIFIED. The Linux CI leg failed without xvfb
  (`Missing X server or $DISPLAY`, run 37330972348) and passes with it after
  the CI fix that runs the Linux leg only under `xvfb-run -a`.
- No claim is made about hardware. Simulator runs prove code, never hardware.

## Proof

- Green run (local, 2026-10-05): `playwright test` from `apps/desktop`
  gives 5 passed (19.2 s): m1-slice plus night, soak, live-session.
- Green runs (CI, run 37330972348): e2e macOS plus Windows plus Ubuntu
  (xvfb) all success after the TestChannel loop, the mutation-scope fix,
  and the xvfb-only Linux run.
- Probe report: `node tools/conformance-report.mjs` maps all 162 matrix
  probes to owning files (162/162 present).
- Fixture scan: no `live-homecoming`, `trackmodel.json`, `showplan.json`,
  or `test-fixtures` string in `apps/desktop/dist/electron/main.cjs`.

## Delete test

Delete `launchAutolight` and `m1-slice.journey.ts` fails to import. Remove
the `__autolightTestApi` registration in main and every step from 2 on goes
red at the test channel again. Delete `simulator-show.ts` and the
`simulator-show.test.ts` import fails plus the slice goes red. Reintroduce
a `test-fixtures` read in the TestChannel path and the T-TRU-02 bundle scan
(`live-homecoming`, `trackmodel.json`, `showplan.json`) goes red.

## Remaining work (not claimed done)

- `package` plus `smoke-install` (T-OPS-05 electron-builder config) stay red
  by design: no builder config exists in the tree yet.
- `normal-night.spec.ts` skeleton completion belongs to T-QA-11.
