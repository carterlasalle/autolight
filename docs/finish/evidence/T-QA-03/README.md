# T-QA-03: Protocol replay harness

Closes F-QA-11, F-LIVE-02 (with `T-LIVE-09`); probe `P-128-replay-decodes`.

## What changed

- `packages/storage/src/replay.ts` (new):
  - `VirtualClock`: monotonic virtual time with a tick counter; moving it
    backwards throws.
  - `runReplay(events, decode, { speed, tickHz, toleranceMs })` for
    `1x`, `2x`, `10x` and `step`. A replay at speed N puts every capture
    timestamp at `captureTime / N` on the virtual clock and ticks the clock at
    the capture's own cadence divided by N; delivery decisions use the unscaled
    capture timeline, so every speed decodes the same event on the same tick.
    The decoder receives the clock, so speed changes the time its logic sees
    instead of only rewriting a timestamp field. Step mode advances the clock
    to each event's own timestamp and fires exactly one event, with no ticks.
  - `compareSequences(expected, actual, { toleranceMs })`: subset comparison
    (expected events omit replay-stamped fields such as `receivedAtNs`) with a
    tolerance on timing fields, so `qa.replay.timeToleranceMs` applies where it
    should.
  - `lintFixture(raw, { fixture, decoderId })`: non-empty capture, software
    version, platform, action, non-empty `expectedEvents`, and an `expectedBy`
    that names a human and is not the decoder. `lintFixtures` runs it over a
    set.
- The harness is decoder agnostic: a fixture set is only a list of
  `{ atMs, kind, payload }` events and a decode function, which is how the same
  code will drive the Rekordbox Lighting decoder, the FLX4 MIDI decoder and the
  Serato Remote decoder as they land.

## Proof

- `packages/storage/src/replay.test.ts` (new, 7 tests):
  - every committed raw frame fixture in `protocol-fixtures/govee/razer`
    (18 files with bytes, excluding the JSON status fixture) is decoded through
    the real `decodeRaw` and compared with the fixture's own declared opcode and
    payload at all four speeds;
  - the committed `status-armed.json` reply is decoded through the real
    `parseStatus` at all four speeds and compared with the documented
    expectation (on, brightness 80, armed);
  - speed semantics: identical states and tick counts across 1x, 2x and 10x,
    capture duration unchanged, replay duration 1/2 and 1/10 of the 1x run, and
    a clock-reading decoder whose stamps scale exactly with the rate;
  - step mode: one event per step, zero ticks, stamps equal to the capture
    timestamps;
  - a mutated decoder fails: a flipped payload byte is reported by
    `compareSequences`, and a broken razer checksum makes the decode return
    nothing, which the sequence comparison catches as a length mismatch;
  - fixture lint over every committed Rekordbox capture fixture, plus mutated
    copies for an empty capture and for `expectedBy` naming the decoder.
- `node_modules/.bin/vitest run --silent=false --reporter=verbose` from
  `packages/storage`: 7 files, 46 tests passed. The P-128 line it prints:
  `P-128: 18 committed raw frame fixtures decoded and matched at 1x/2x/10x/step,
  1x ticks 108, replay 1800.0000000000002 ms, 10x replay 180.00000000000003 ms`.
- Simulator runs prove code, never hardware; no hardware claim is made here.

## Delete test

Delete `clock.tickTo(captureNow / factor)` and the speed test fails, because
the virtual clock stops moving with the rate. Delete the delivery loop's
`captureNow = tick * tickMs` and the tick counts diverge between speeds (the
floating point drift this replaced produced 109 ticks at 10x against 108 at
1x). Delete `compareSequences` and the mutation test stops failing, which is
the whole point of a replay harness. Delete the `expectedBy` check in
`lintFixture` and the authorship mutation passes lint. Delete `decodeRazer`'s
use of `decodeRaw` and the comparison goes against expectations that no decoder
produced.

## Remaining work (not claimed done)

- The Rekordbox Lighting raw capture decoder does not exist yet (`T-LIVE-09`
  owns it; the committed fixture files themselves say
  `handwritten-synthetic: real Lighting capture pending owner runbook
  HW-RB-LIGHT-01`). Those fixtures are linted here (envelope, authorship,
  non-empty capture) and will be driven through `runReplay` unchanged once that
  decoder lands; no DeckState replay of them is claimed.
- Serato Remote, OS2L, ProLink and FLX4 MIDI captures are not committed yet, so
  the sweep covers the Govee razer and status fixtures today.
- The harness runs in the package test suite; wiring it into the T-QA-01 class
  registry and the nightly fixture job is that task's step.
