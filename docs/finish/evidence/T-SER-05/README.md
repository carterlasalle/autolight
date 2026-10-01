# T-SER-05: Serato protocol fixtures and replay

Closes F-SER-05.

## What changed

- `packages/serato/src/replay.ts` (new): the fixture envelope
  (`seratoVersion`, `platform`, `action`, `capture`, `frameTimesMs`,
  `expectedEvents`, `expectedBy`, `provenance`), the frame splitter that reads
  the delimiter from serato-connect's own `frameOsc`, burst grouping (a gap of
  at least 50 ms, the same window the dependency uses before it publishes a
  settled track), and `replaySeratoFixture` / `replaySeratoFrames` /
  `replaySeratoFixtureStep` at 1x, 2x, 10x and step on a virtual clock. Speed
  changes the clock the decoder sees, not only a timestamp field.
- `packages/serato/src/capture.ts` (new): `SeratoCaptureProxy`, the loopback
  capture tool. It listens on the port the DJ software connects to, forwards
  every byte to the provider's server unchanged, and records the peer's bytes
  as wire frames (split on the protocol delimiter). Recorded frames are what
  arrived, so a capture can be committed and replayed.
- `protocol-fixtures/serato/3.3.5/macos/<action>/capture.json` (new, 14
  fixtures): load-deck-1, load-deck-2, play, pause, seek, loop-4-beat,
  loop-1-beat, loop-roll, pitch-plus-8, crossfader, upfader, two-decks,
  replace-track, eject-deck-1. `capture` is the base64 wire stream, and
  `expectedEvents` are hand-authored from each action script (see the
  emulator), not produced by the decoder.
- `packages/serato/src/replay.test.ts` (new): lint, replay and comparison for
  every fixture, the speed semantics, and the cross-check against the shared
  T-QA-03 harness in `packages/storage`.

## Proof

- `cd packages/serato && yarn vitest run src/replay.test.ts`: 9 tests passed.
  Every fixture lints (non-empty capture, software version, platform, action,
  human-authored expectation, non-empty expected events), replays at all four
  speeds, and matches its hand-written `expectedEvents` through the shared
  `compareSequences` (tolerance `qa.replay.timeToleranceMs`, 5 ms).
- Speed semantics: 2x and 10x carry the same states and the same per-event
  offsets divided by 2 and 10 on the virtual clock; step mode equals 1x.
- Cross-check: for every fixture at every speed, replaying the same burst
  events through `packages/storage`'s `runReplay` produces the same DeckState
  sequence.
- Self-consistency: the committed capture bytes equal exactly the frames the
  action scripts produce, so regenerating is reproducible.
- Red runs: a mutated capture byte (flipped in the last frame's address) and a
  deliberately wrong expectation both produce non-empty `compareSequences`
  problems.
- `packages/serato/src/capture.test.ts`: the emulator connects through the
  proxy; the recorded stream equals the sent stream byte for byte; and
  replaying the capture reproduces the live provider's settled deck states for
  both decks (generation, track, playhead, faders, crossfader), which is the
  equivalence proof between the client's event path and the message path.

## Delete test

Delete `splitFrames`' trailing-byte check and the frame-count test goes red.
Delete the burst grouping and the fixture expectations stop matching (one
state per frame instead of per load burst). Delete the proxy's synchronous
`pipe` wiring and the capture test times out in the handshake, because bytes
that arrive before the upstream connection is piped are consumed instead of
forwarded.

## Remaining seams (not claimed done)

- Every committed fixture is emulator-generated (`provenance` says so) and is
  therefore not counted toward spec 121 item 16 until `HW-SER-01` records a
  real Serato DJ Pro 3.3.5 session and replaces it. The capture tool for that
  run is `SeratoCaptureProxy`; the runbook itself is `wp15`.
- Spec 119 actions the Remote protocol cannot express (scratch, reverse, sync
  toggles, hot cue jumps, master switch, cue restart) have no fixture on
  purpose: the protocol carries no message for them. They are listed as
  unsupported in the T-SER-06 checklist rather than faked here.
- Fixture path note for the orchestrator: wp09 names
  `protocol-fixtures/serato/<serato-version>/<platform>/<action>/` and this
  slice used exactly that layout, which is outside its listed target paths.
  `1x/2x/10x/step` for a real capture also needs the owner run.
