# T-LIVE-13: Version registry, qualification records and the unverified banner

Closes F-LIVE-08. Probes P-145-unverified-banner, P-146-registry.

## What changed

- `packages/rekordbox-live/src/version-registry.ts` (committed source):
  - `RekordboxProtocolDefinition` per provider: `versionRange`,
    `platform`, decoder id, fixture set, qualification record (date,
    machine, runbook, results). Replaces string-prefix `isSupported`
    checks; `versionInRange` matches on the range stem so `7.2.x` covers
    `7.2.19` and `7.2.19.0012` but not `7.3.0`.
  - Per-provider status: `qualifyProvider` reports `qualified`,
    `unverified` (probing allowed, not declared supported) or
    `unsupported` for the running Rekordbox version, detected from the
    macOS bundle `Info.plist` (`detectMacosVersion`) or the Windows file
    version (`detectWindowsVersion`).
  - `UNVERIFIED REKORDBOX VERSION` banner text for the status bar and the
    source badge, never a modal during Live (spec 144).
    `recordQualification` flips a version to qualified only when the
    replay suite passes; a failed replay keeps it unverified.
  - Seed registry from the documented versions: rkbx-osc community
    offsets, the prolink/AX transports, and pending Lighting/memory rows
    that stay unverified until their captures land.
- No source or test change in this slice: the registry already passes its
  tests and the banner contract.

## Proof

Scoped run, 2026-10-01:

- `yarn workspace @autolight/rekordbox-live test`: 18 files, 129 passed.
  That includes `version-registry.test.ts`: stem matching (not prefix),
  qualified/unverified/unsupported per provider (rkbx-osc 9.9.9
  unsupported, 7.2.19 macOS unverified until a passing replay record
  flips it qualified, a failed replay keeps it unverified), the banner
  for simulated 9.9.9 without a modal, plist plus file-version detection,
  and the registry JSON round trip for generated fixture metadata.

## Delete test

Delete the stem match in `versionInRange` (use a raw prefix) and the
`7.3.0` row goes red. Delete the replay-passed gate in
`recordQualification` and the failed-replay-keeps-unverified test goes
red. Delete the banner null-when-all-unsupported branch and the 9.9.9
banner test goes red.

## Seams

- The registry is generated from committed fixture metadata: each new
  fixture set (Lighting captures, memory offsets, rkbx captures) flips
  its version to qualified only when its replay suite passes.
- The Settings panel renders its matrix from the registry, not hardcoded
  text (T-LIVE-15 consumes this); the status bar and source badge render
  the banner string inline.
