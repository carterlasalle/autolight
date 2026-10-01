# T-DATA-06: Session recorder and exact replay

Closes F-DATA-06; probes `P-102-event-inspector`, `P-103-replay-exact`;
wp14 section T-DATA-06; spec 103.

## What changed

- `packages/storage/src/session.ts` (new): `SessionRecorder` records DJ
  events, deck states, provider status, show decisions, renderer frame
  hashes per tick, device health, errors and config changes. No audio.
  Storage is a bounded ring: a circular buffer with a byte budget from
  `diagnostics.recorder.maxMb`. The oldest entry is overwritten in place,
  never removed with `shift()` on a large buffer. Export is `.ndjson`
  (`exportNdjson`); `parseSessionNdjson` fails loudly with line numbers.
- Replay: `replaySession` feeds recorded tick inputs back through a render
  function with the same config snapshot and compares frame hashes.
  `frameHashFor` is the deterministic hash (same tick plus same inputs
  plus same snapshot give the same hash). 100 percent equality is the
  P-103 bar; `SessionReplayResult` is named to avoid colliding with the
  `ReplayResult` protocol harness in `replay.ts`.
- Re-exported from `packages/storage/src/index.ts`.

## Proof

- `packages/storage/src/ops.test.ts` (session block, 5 tests): bounded
  ring drops the oldest under a 1 KB budget with `droppedCount` counting;
  60 ticks replay at 100 percent frame hash equality on one snapshot; a
  deliberately nondeterministic render (`random-N`) mismatches all 10
  ticks; malformed lines rejected with line numbers; disabled recorder
  stays silent.
- `yarn workspace @autolight/storage run test`: 10 files, 73 tests passed.

## Delete test

Delete the ring overwrite and the bounded test overflows or throws. Return
a constant hash from `frameHashFor` and distinct inputs collide, so the
nondeterministic test can no longer mismatch. Delete `replaySession` and
every replay test fails to import.

## Seams

Production wiring (show host tick recording, simulator provider injection,
recording transport) belongs to the runtime slice; this module is the
storage half with the exact-replay contract. The `render` argument is the
seam: production passes the renderer frame hash, the simulator passes its
re-render.
