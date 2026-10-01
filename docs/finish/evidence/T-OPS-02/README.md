# T-OPS-02: Structured logging

Closes F-OPS-01; probe `P-130-log-schema`; wp14 section T-OPS-02; spec 130.

## What changed

- `packages/storage/src/logging.ts` (new): `Logger` used by every process
  (main, show host, audio window, worker via forwarding) with the spec 130
  fields (timestamp, monoMs, module, severity, session, deck, track,
  fixture, event, latencyMs, message), JSON lines, file rotation inputs
  (`diagnostics.log.maxFileMb`, `diagnostics.log.files` consumed by the
  writer), raw protocol lines only in diagnostic mode, and rate limiting
  of repeated messages (10 per second default, suppressed counted).
- `validateLogLine` plus `validateLog` are the P-130 check: every line of
  a session log validates against the schema; a `rawProtocol` field
  outside diagnostic mode is a violation.
- Re-exported from `packages/storage/src/index.ts`.

## Proof

- `packages/storage/src/ops.test.ts` (logging block, 3 tests): one JSON
  line with all spec fields validates clean; raw protocol dropped in
  normal mode and kept plus validated in diagnostic mode (and flagged
  when validated as normal); 5 identical warnings in one window emit 2
  lines with 3 suppressed; non-JSON rejected.
- `yarn workspace @autolight/storage run test`: 10 files, 73 tests passed.

## Delete test

Delete the `rawProtocol` strip and the normal-mode assertion finds the
field. Delete the rate limiter and 5 warnings emit 5 lines. Emit a line
without `monoMs` and `validateLog` reports it.

## Seams

File rotation and cross-process forwarding live in the Electron logging
service; this module is the line format plus the P-130 validator.
