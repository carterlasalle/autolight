# T-DOC-04: THIRD_PARTY_NOTICES and provenance headers

Closes F-DOC-07.

## What was built

- `THIRD_PARTY_NOTICES.md` (new): direct upstream dependencies with
  versions and licenses verified against installed manifests
  (govee-toolkit 0.5.0, serato-connect 1.4.6, rekordbox-connect 1.2.17,
  pyrekordbox 0.4.4, all-in-one-infer 3.1.0, beat-this 1.1.0, Electron
  41.10.6), adapted sources (govee-toolkit, govee2mqtt, homeassistant,
  lightwave), study-only boundary (dysentery, rkbx_link GPL-3.0,
  rkbx_os2l unlicensed, Skip-BART and SeqLight), hand-listed runtimes,
  and all 84 Python environment rows from the `THIRD_PARTY_NOTICES`
  JSON report grouped by license. Nothing from rkbx_link, rkbx_os2l or
  LedFx enters the tree; Skip-BART and SeqLight stay research only.
- Provenance headers: every adapted file already carries one
  (`packages/govee/src/*`, `apps/desktop/electron/govee-lan.ts`,
  `packages/simulator/src/govee-lan.ts`, `packages/ble/src/*`,
  `packages/rekordbox-library/src/options.ts`). No new headers were
  needed; the header check below asserts the adapted set stays headed.
- `tools/license-check.mjs --self-test` passes (denylist, planted GPL,
  rkbx_link manifest tripwire, Skip-BART weight tripwire).

## What passes today vs what waits

- Passes today: notices file present and row-complete against the
  JSON report; self-test green; header grep over the adapted set.
- Waits on the orchestrator: `yarn truth` header check wiring (truth
  slice), CI license scan on a full `yarn install` (the Yarn scan
  reports zero rows in this environment; rerun and record flagged
  rows before release).

## Proof

- `node tools/license-check.mjs --self-test`: OK.
- `node -e` JSON parse of `THIRD_PARTY_NOTICES`: 0 yarn, 84 pip,
  6 hand rows; every pip row appears in `THIRD_PARTY_NOTICES.md`
  section 5.
- `grep -rn Provenance:` over the adapted set: headers present.

## Delete test

Delete `THIRD_PARTY_NOTICES.md` and the spec 112 probe has no notices
file to read. Remove a `Provenance:` header from any adapted file and
the header grep goes red. Add a GPL dependency and the license
self-test denylist goes red.

## Seams

- Regenerate the JSON with `node tools/license-check.mjs`, then
  update `THIRD_PARTY_NOTICES.md` section 5 to match; the two must
  never drift.
- New adapted files must add a `Provenance:` header at creation time.
