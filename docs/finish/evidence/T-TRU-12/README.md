# T-TRU-12: Runtime invariants

Closes F-QA-14 (runtime invariants), scar S17.

## What changed

- New `packages/show-host/src/invariants.ts`: `checkInvariants(ctx, telemetry?)`
  returns typed `InvariantViolation[]` and never throws. A defensive outer
  try/catch converts internal failures into a report, and telemetry failures
  are swallowed so a diagnostics outage cannot crash the show.
- Covers all eight spec invariants: per-device pending frames at most 1;
  no `turn off` or kelvin `colorwc` to an armed fixture; segmented fixtures
  carry their full zone count; host tick off the renderer thread; finite
  beats; DeckState age within `live.provider.staleMs` or clock health not
  `live`; brightness rate under `govee.brightness.maxPerMinute`; no cloud
  transport carrying frames.
- Telemetry hook: any `{ record(kind, payload) }` sink (for example the
  diagnostics `SessionRecorder`) receives one `invariant` event per
  violation with code, message, and device id.
- New `packages/show-host/src/invariants.test.ts`: one clean context test
  with zero reports, one deliberate violation test per invariant, plus a
  never-throws test covering telemetry failure and null context.

## Proof

- Orchestrator runs `yarn workspace @autolight/show-host test`. Simulator
  runs prove code only and never qualify hardware.

## Delete test

Delete any single check (for example the `pending > 1` comparison in
`checkPending`) and its matching violation test goes red while the clean
test still passes. Delete the clean test fixture field (for example set
`frameZones` to 1 zone in `clean()`) and the clean test reports a
`segment-zones` violation. Remove the outer try/catch in `checkInvariants`
and the null-context never-throws test throws instead of reporting.
