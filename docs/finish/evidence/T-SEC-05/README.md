# T-SEC-05: Consent and audit for privileged helpers

Closes F-SEC-03 (with T-LIVE-11); wp14 section T-SEC-05.

## What changed

- `packages/storage/src/consent.ts` (new): `consentTextFor` states what
  the helper does, what it needs (re-signing Rekordbox, elevated
  privileges), the risks (notarization removed, updates may break it,
  security warning at launch), and how to undo it. `ConsentStore.grant`
  records the explicit opt-in with a timestamp and text hash;
  `startHelper` refuses without consent (never performs re-sign or
  elevation itself); every start, stop, grant and revoke appends to an
  audit list for Diagnostics.
- Re-exported from `packages/storage/src/index.ts`.

## Proof

- `packages/storage/src/ops.test.ts` (consent block, 1 test): start
  without consent refused; grant with timestamp recorded; start audited;
  stop audited; revoke removes consent and start is refused again; audit
  order is `consent-granted, start, stop`.
- `yarn workspace @autolight/storage run test`: 10 files, 73 tests passed.
- E2E of the consent flow on SIM belongs to the UI slice; this module is
  the consent plus audit store it drives.

## Delete test

Remove the consent check in `startHelper` and the refused-start assertion
goes red. Stop appending audit entries and the action-order assertion
fails. Empty the memory-reader text and the needs/undo assertions fail.

## Seams

Settings renders `consentTextFor` with grant/revoke buttons; Diagnostics
renders `entries()`. The memory reader itself is T-LIVE-11.
