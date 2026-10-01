# T-SEC-01: Secrets in safeStorage

Closes F-DATA-07, F-CLD-01 (secret part).

## What changed

- `packages/config/src/secrets.ts` (new): secret id table
  (the cloud API key, the agent API token), `SecretVault` (live values in
  memory, one encrypted blob of the persistent subset on disk, memory-only
  ids never reach the blob, throws instead of writing plain text when the OS
  keychain is unavailable), `containsSecretText` / `redactSecretText` for
  log boundaries. Co-owned seam: QualM6 owns
  `registry-validation.property.test.ts` in the same package; untouched.
- `packages/config/src/base.ts`, `store.ts`: `set`, `importJson`, and
  `validateImportValues` reject secret ids with a fix message pointing at
  the secrets-service. Secret ids are not registry keys, so config export
  and the JSON file cannot carry them.
- `apps/desktop/electron/services/secrets-service.ts` (new): the only
  holder of secret values in main. Blob file
  `<userData>/secrets.enc.json` (`{version, blob}` base64 of safeStorage
  ciphertext); corrupt or missing file degrades honestly; no keychain path
  means memory-only session. Presence-only API for Settings and
  diagnostics. `redactSecrets` helper for log boundaries.
- Cloud key wiring: `CloudService` keeps its `apiKey` constructor seam
  (production passes the value from `SecretsService.getSecret`, never from
  config); Settings shows `stored` with replace/remove, never the value.

## Proof

- `yarn workspace @autolight/config run test`: 27 passed across 5 files,
  including all 7 secrets tests, the new config-layer boundary test, and
  every pre-existing config test (QualM6 fixed their property regex after
  the earlier report).
- `tsc --noEmit -p tsconfig.typecheck.json` in `apps/desktop`: zero errors
  in `electron/services/secrets-service.ts` and
  `secrets-service.test.ts` (remaining errors are pre-existing sibling
  slices in rekordbox-live and venue).
- Log scan: `secrets-service.test.ts` writes the live key, reads the blob
  file back, and asserts the plain value appears nowhere in it.

## Delete test

Revert `SecretVault.flush` to write the JSON file directly and the
round-trip, opaque-blob, and plain-text-scan tests go red. Remove the
`isSecretId` guard in `ConfigStore.set` and the boundary test goes red.
Delete `SecretsService.getSecret` and the restart test goes red.

## Remaining seams

- Settings replace/remove UI and the Diagnostics presence row (T-UI work);
  the presence() API they read is done.
- Crash-record writer must call `redactSecrets` with `liveValues()`
  (one-line call at the T-OPS-07 site).
- Session recorder payload gate: reject payloads containing live values
  (same one-line `containsSecretText` check).
- Release bundle scan must reject `secrets.enc.json` plaintext fixtures
  (T-TRU-11 job).
