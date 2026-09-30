# T-QA-02: Electron E2E harness plus M1-slice probe skeleton

Closes F-QA-02, F-X-16 (re-verify). Used by every UI probe.

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
- Test-build-only channel `qa/recording-frames`: registered by main only
  when `AUTOLIGHT_TEST_BUILD=1` is set, exposing `stages`, `library`,
  `fixtures`, `decks`, `plan`, `frames`, `commands`, `snapshot`,
  `resume-status`, `freeze-renderer`, `shutdown`. Release-bundle-scan note:
  `yarn truth` greps the built main and renderer bundles for
  `qa/recording-frames` and must reject any hit, so this channel can never
  ship in a release build. Today's main does not register it yet, which is
  exactly what makes the slice red.

## What passes today vs what waits

- Passes today: step 1. The harness launches the real built app in
  Simulator mode with a clean profile; `#root` mounts; a screenshot is
  captured. Proven by the red run below (step 1 green, failure at step 2)
  and by the untouched sibling journeys (`night`, `soak`, `live-session`:
  4 passed).
- Waits on T-ARC-01 (show host): startup stages, ANLZ track resolution,
  real planner, snapshot equality (step 8 with T-ARC-04), resume on bar,
  renderer-free tick (P-56), ending look and disarm (with T-ARC-03).
- Waits on T-GOV-14 (simulator plus recording transport): H6076 discovery,
  rkbx-osc deck state, razer frames at rate, one arm with zero `turn` and
  zero kelvin `colorwc`, keypress-to-send timestamps.
- No claim is made about hardware. Simulator runs prove code, never hardware.

## Proof

- Red run: `docs/finish/evidence/T-QA-02/red-run.txt`. Step 1 passes; step 2
  fails with `test channel unavailable (ipcMain handlers: open)`, the
  expected failure while T-ARC-01/T-GOV-14 are unbuilt. Command:
  `playwright test --config playwright.config.ts journeys/m1-slice.journey.ts`
  from `apps/desktop` (exit 1).
- No-regression run: sibling journeys untouched and green:
  `playwright test --config playwright.config.ts journeys/night.journey.ts
  journeys/soak.journey.ts journeys/live-session.journey.ts` gives 4 passed.
- F-X-16 (xvfb boot) result: UNVERIFIED on this machine. This run booted
  Electron natively on macOS arm64 (Darwin, DISPLAY from XQuartz only).
  `which xvfb-run` finds nothing here because xvfb ships on Linux CI only.
  The harness carries the xvfb path (`xvfb-run` wrapper on Linux,
  `XVFB_RUN=1` marker env) but no xvfb boot was observed in this
  environment. Linux CI must record its own xvfb boot log as the
  F-X-16 evidence; until then F-X-16 stays open.

## Delete test

Delete `launchAutolight` and `m1-slice.journey.ts` fails to import. Register
the `qa/recording-frames` test channel in main (T-ARC-01) and the red run
turns green step by step; remove the channel and the slice goes red again.
Grep the built bundles for `qa/recording-frames` after the channel lands:
a release build must show zero hits.

## Remaining work (not claimed done)

- T-ARC-01 registers the test channel, the startup state machine, the show
  host tick, plan install, snapshot, resume, and shutdown paths.
- T-GOV-14 provides the loopback device simulator and the recording
  transport behind the channel.
- T-TRU-11 wires the harness into CI on all three OSes (Linux under
  `xvfb-run`) plus the packaged-app smoke-install job.
- `normal-night.spec.ts` skeleton completion belongs to T-QA-11.
