# T-LIVE-14: Master deck, loop, pitch, SYNC, hot cue and roll state

Closes F-LIVE-12, F-LIVE-13, F-MIX-08.

## What changed

- Committed sources (no edits in this slice): every provider that has
  these fields acquires them, and fusion (T-LIVE-02) fuses them. The mixer
  consumes `master` (T-MIX-01, T-MIX-03); the runtime consumes loops and
  rolls (T-RUN-04). FLX4-observed states are hints with quality
  `estimated` unless a DJ-software source confirms them (spec 11: never
  override a stronger source). A track switch mid-loop never carries the
  loop into the new generation.
- `packages/rekordbox-live/src/master-fields.test.ts` (this slice,
  test-only): the FLX4 hint test now honors fusion hysteresis. Both
  providers ingest at the same instant, so the first fused read keeps the
  incumbent composite hint (`active: true`, source `composite-flx4`);
  the clock then advances past `live.fusion.switchHoldMs`, prolink
  re-ingests fresh, and the fused field flips to the higher-authority
  DJ-software truth (`active: false`, source `prolink`). Before, the test
  asserted the flip on the first packet and failed with `expected true
  to be false`.

## Proof

Scoped run, 2026-10-01:

- `yarn workspace @autolight/rekordbox-live test`: 18 files, 129 passed.
  That includes `master-fields.test.ts`: prolink loop plus beat counter
  cleared on track replacement, rkbx-osc mid-loop track switch bumping
  generation without carrying the loop, master fused from prolink with
  pitch from rkbx-osc per field authority, and the FLX4 hint test holding
  through the switch window then yielding to exact DJ-software truth.
- Failure before: the FLX4 hint test failed at line 97 (`expected true
  to be false`). Failure after: the file passes.

## Delete test

Delete the `pending`-challenger hold in `FusionEngine.pick` and the FLX4
hint test goes red (the field flips on the first challenger packet, so
the hold assertion fails). Delete the generation bump in
`DeckGenerationMapper.update` and the mid-loop track-switch tests go red.

## Seams

- Field suppliers: Lighting IPC, memory reader, rkbx-osc master messages,
  ProLink status flags, FLX4 buttons and LEDs as secondary truth.
  Composite FLX4 owns the hint production (T-LIVE-07); this task owns the
  fusion of the fields.
- `fieldSources`/`quality` on every fused state let the status bar source
  badge and the DJ Event Inspector show which provider owns each field.
