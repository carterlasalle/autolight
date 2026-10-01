# T-ANA-01: Worker protocol that cannot be corrupted or killed by one bad line

Closes F-ANA-21.

## What changed

- `analysis/src/autolight_analysis/protocol.py` (new): `protect_stdout()`
  duplicates fd 1 for the protocol and points `sys.stdout` and C-level fd 1
  at stderr; newline-delimited JSON frames carry `v` plus a request `id`;
  `parse_frame` raises typed `ProtocolError`; `error_frame` truncates the
  offending line; `Heartbeat` emits frames at `analysis.worker.heartbeatMs`;
  `log_event` writes JSON to stderr.
- `worker.main()`: every frame is parsed inside the guard (malformed line
  produces a typed `error` frame and the loop survives), `cancel` by id,
  per-job `progress`/`complete`/`failed` frames, per-job exception guard.

## Proof

- `uv run pytest tests/test_protocol.py -q` (malformed JSON, a library print
  line, fd-writer round trip, `handle` typed failure, protocol version).
- `uv run pytest tests/ -q` from `analysis/`: full suite green after the
  rewrite (52 passed at last recorded run).

## Delete test

Delete the `except ProtocolError` branch in `main()` and
`test_malformed_frame_is_typed_not_fatal` fails; delete `protect_stdout` and
the fd-writer test fails on a closed/redirected stdout.

## Seams

- The supervisor side of heartbeat/cancel lives in
  `packages/analysis-client/src/index.ts` (T-ANA-02).
- Structured stderr logging is forwarded to the app log by T-OPS-02, outside
  this slice.
