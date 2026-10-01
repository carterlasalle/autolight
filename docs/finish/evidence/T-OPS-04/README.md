# T-OPS-04: Update strategy

Closes F-OPS-04; probe `P-145-unverified-banner` (with T-LIVE-13); wp14
section T-OPS-04; spec 145.

## What changed

- `apps/desktop/electron/updater/index.ts` (new, T-OPS-04 only): update
  decisions from the registry keys `update.checkOnLaunch` and the
  `update.neverDuringLive` invariant. `decideUpdateCheck` checks only when
  enabled and defers while Live is active or a show is loaded.
  `noteUpdateAvailable` records an available update during Live as a status
  notice with no modal (spec 144). `canInstallUpdate` gates the install.
  Dependency versions stay locked (Yarn lockfile, `uv.lock`) and CI-tested.

## Proof

- `apps/desktop/electron/updater/index.test.ts` (new, 3 tests): check only
  when enabled; defer while Live or show loaded with install gated off;
  Live-time availability noted as "install after Live" with no modal word.
- Targeted runs: storage 73 passed (10 files); config compare 3 passed;
  desktop services suite 17 passed.

## Delete test

Delete the Live branch in `decideUpdateCheck` and the defer test goes red.
Allow install during Live and the gate test fails. Mention a modal in the
notice and the no-modal assertion fails.

## Seams

Wiring to electron-builder's updater (or manual download, owner choice
recorded) and the status-notice UI read this module. The unverified-version
banner is T-LIVE-13.
