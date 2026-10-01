# T-CLD-01: Cloud metadata client

Closes F-CLD-01, F-GOV-17. Spec 148 (cloud never for frames).

## What was built

- `packages/cloud/` (new package `@autolight/cloud`): `src/client.ts` is the
  Govee OpenAPI metadata client. Device list, declared capabilities
  (segment counts and instances), names, scene catalogues. Rate limiting per
  `govee.cloud.*` with accounting from response headers; clear errors when
  limits are hit. Disabled unless both `govee.cloud.enabled` and
  `security.cloudAllowed` hold; `ensureNotShowTick` rejects any call
  scheduled from the show clock, mirroring the T-TRU-12 no-cloud-frames
  invariant. The API key arrives from the caller (T-SEC-01 owns safeStorage)
  and never appears in an error, a log, or a recording.
- Limits follow the vendor docs via govee-toolkit `docs/protocol/cloud.md`:
  10 requests per minute per device (`govee.cloud.perDevicePerMinute`) and
  10000 per day per account (`govee.cloud.perAccountPerDay`), both
  configuration, both enforced with sliding windows plus server 429 and
- T-CLD-02 lives in the same package: `src/cross-check.ts` compares the
  cloud-declared segment count with the measured one; a disagreement is
  recorded in the device evidence while the measured count stands. Its tests
  are `src/cross-check.test.ts` (5 tests) and its full page is
  `docs/finish/evidence/T-CLD-02/README.md`.

## What passes today vs what waits

- Passes today: 11 tests in `packages/cloud/src/client.test.ts` plus 5 in
  `src/cross-check.test.ts` (16 total, all green with typecheck clean).
- Waits on T-SEC-01: API key storage in safeStorage and the Electron main
  wiring that supplies fetchFn. Waits on hardware: recorded responses here
  are sanitised literals shaped like the OpenAPI device list and scene
  catalogue, not live captures.

## Proof

- `yarn workspace @autolight/cloud test`: 2 files, 16 tests passed.
- `yarn workspace @autolight/cloud typecheck`: clean.
- Red runs: gutting `ensureNotShowTick` to a no-op makes the show-tick
  rejection test red (1 failed, 15 passed); reducing `crossCheckQualification`
  to always agree makes 3 cross-check tests red (disagree, cloud-silent
  entry, absent cloud).

## Delete test

Delete `packages/cloud/src/client.ts` and both test files fail to import.
Delete `packages/cloud/src/cross-check.ts` and the cross-check tests fail to
import. Remove the `enabled/cloudAllowed` guard and the disabled-by-default
test goes red. Remove the show-tick guard and the rejection test goes red.
Widen the minute budget check and the per-device limit test goes red.

## Remaining seams

- Live captures against a sanitised recording harness (T-QA-03 style) once
  the owner provides an API key; the fetchFn seam already supports it.
- Electron main fetch wiring and safeStorage handoff belong to T-SEC-01.
