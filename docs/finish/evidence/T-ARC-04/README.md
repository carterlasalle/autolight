# T-ARC-04: Snapshots and renderer reload survival

Closes F-APP-02 (with T-ARC-01, T-RUN-01), spec 92, 108.

## What changed

- New `packages/show-host/src/snapshot.ts`: versioned UI snapshot
  (`version: 1`) built from the published `HostSnapshot`: per-deck cursor,
  current section, upcoming cues with beats and seconds until, owner,
  weights, exact per-cell output colors before calibration, device health,
  host metrics. `serializeSnapshot` plus `parseSnapshot` round trip through
  the zod schema (wrong versions and malformed payloads throw), and
  `measureSnapshot` checks size against `runtime.snapshot.maxBytes`.
  `latestPublishedSnapshot` picks the newest wire snapshot by tick.
- New `apps/desktop/electron/services/snapshot-bridge.ts`: main-side
  forwarder from the host to subscribed renderers, latest wins. It keeps
  only the newest snapshot and replays it on every subscribe and on every
  renderer did-finish-load, so a reloaded window renders within one
  snapshot interval while the host and transport never notice the reload.
- New `packages/show-host/src/snapshot.test.ts`: the two acceptance
  probes plus the size probe. `P-92-snapshot-equals-output` drives the
  real `ShowHost` with the simulator deck and fixture helpers, hands each
  published snapshot tick to the simulator `RecordingTransport` as a razer
  datagram, and asserts the per-cell colors equal the recorded frame for
  the same tick, then asserts re-rendering the active cues at the snapshot
  beat reproduces the same bytes. `P-108-reload` ticks the host 120 times
  with 10 simulated renderer reloads (two dark ticks each) and asserts the
  host tick counter never skips and every replay is the latest published
  tick.
- Measured on this machine with the two-fixture eight-cell rig over 200
  serializations: 1253 bytes against `runtime.snapshot.maxBytes` 262144,
  p50 0.003 ms, max 0.009 ms, well under budget. Worst case 2000-cell
  venue (100 fixtures times 20 cells): 122383 bytes, p50 0.22 ms, max
  0.80 ms, still under budget. Simulator runs prove code, never hardware.

## Proof

- `yarn workspace @autolight/show-host test`: 24 passed (11 invariants,
  4 host, 3 snapshot probes, 6 clock).
- Scoped probe run `vitest run src/snapshot.test.ts`: 3 passed.
- Negative controls run in this session: flipping one color bit in the
  test helper turns P-92 red with a hex mismatch; duplicating one
  transport tick turns P-108 red on the gap assertion. Both restored green.

## Delete test

Delete the transport `send` call in the P-92 test and it fails with zero
recorded frames. Delete the tick continuity assertion in P-108 and a
duplicated transport tick passes silently. Delete the `maxBytes` throw in
`ShowHost.publish` and the oversize path loses its guard (the budget probe
keeps the measured receipt).
