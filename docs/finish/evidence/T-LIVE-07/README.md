# T-LIVE-07: Composite FLX4 provider (`composite-flx4`)

Closes F-LIVE-06, F-LIVE-07 (composite part). Probe P-10-composite.

## What changed

- `packages/rekordbox-live/src/composite.ts` (new): `CompositeProvider`
  (id `composite-flx4`, already in `DEFAULT_FUSION_AUTHORITY` and
  `live.fusion.authority`, so it is selectable in fusion with no config
  change) plus pure helpers:
  - Controller input: `CompositeControllerEvent` per deck (play, cue, sync,
    LOAD, hot cue, loop in/out/exit/halve/double, pad roll, jog touch/move,
    channel fader, crossfader, filter, tempo). MIDI is secondary truth
    (spec 11): inside this provider there is no stronger source, so transport
    edges drive the estimate and are labelled derived/estimated, never exact.
  - Track-open observation: `pollOpenFiles` correlates pending LOAD presses
    with the host's open-file list via `matchLibraryAudio` (audio extensions
    under the library roots) and the injected `resolveTrack` (library
    resolver seam, WP06). LOAD is unload-then-load: the old generation ends
    immediately, the resolved track opens a new one. No new file means a new
    `unresolved` generation, never reuse of the old track.
  - Playhead estimation: anchor plus rate from the tempo fader through
    `flx4.tempoRange` (`tempoRangePercent`, fittable via
    `estimateTempoRangePercent` median of implied ranges); jog moves nudge
    the anchor and unlock; cue pauses to the cue point. Beat and beat-in-bar
    come from the native grid (`gridBeatAt`); effective BPM from the grid
    segment times rate (`gridBpmAt`), with an injected Link tempo seam
    (T-LIVE-12) cross-checking when fresh.
  - Audio timing correction: `pushAudio` loopback onset frames are
    cross-correlated (`correlateEnvelopes`, normalized, min-overlap guard,
    lag capped to +-6 samples to stay inside one onset period) against the
    estimate-anchored reference window; corrections slew in capped per tick
    like the T-RUN-02 estimator, never stepping backwards while playing.
    Two decks audible correlate against the fader-weighted mix
    (`mixReferences`) attributed to the louder deck. Quality promotes from
    `estimated` to `derived` on lock.
  - Master resolves to the louder deck by fader weight; loop out measures
    beats between loop-in and loop-out on the grid; sync toggles; hot cue
    records pad plus time. `reportMidiUnavailable` surfaces the Windows
    single-client case as `unavailable` with remedy; malformed input is
    rejected and counted, never thrown.
- Barrel: `export * from "./composite.js"` appended after the agent-api line
  in `packages/rekordbox-live/src/index.ts` with LiveSetupAssist clearance;
  no other barrel line touched. No export name collides with existing sources.
- `packages/rekordbox-live/src/composite.test.ts` (new): 11 tests.

## Proof

Scoped runs (2026-10-01, no gates per dispatch):

- `yarn workspace @autolight/rekordbox-live exec vitest run
  src/composite.test.ts`: 11 passed, including the shared contract suite
  with a virtual MIDI timeline (0 failures), lock promotion to `derived` on
  aligned synthetic loopback audio, LOAD plus open-file resolution with a
  generation bump, master to the louder deck, and malformed rejection.
- Full package suite `vitest run` in `@autolight/rekordbox-live`: 11 files,
  92 tests passed (includes the pre-existing contract/fusion/manager suites;
  fusion already treats `composite-flx4` as a ranked authority).
- `tsc --noEmit -p tsconfig.json` in the package: the only diagnostic is in
  `src/lighting-ipc.ts` (LiveM2Bundle's new file, not this slice); this
  slice's files are clean.

## Delete test

Delete the generation bump in `DeckGenerationMapper.update` and the
track-resolution test plus the contract-suite test go red. Delete the
`minOverlap` guard in `correlateEnvelopes` and the lock test goes red (lag
peaks at the window edge). Delete the LOAD branch in `ingestControllerEvent`
and the resolution tests go red.

## Seams

- Consumes the T-FLX-06 feed (`Flx4Feed` drained into
  `ingestControllerEvent`); the feed maps the T-FLX-02 deck-aware decoder.
- `resolveTrack` is the WP06 library resolver seam; `listOpenFiles` is the
  host `lsof`/Windows-helper seam; `linkTempo` is the T-LIVE-12 seam.
- Emits `ProviderDeckState` with `fieldSources`/`quality`, so fusion
  (T-LIVE-02) ranks it with no downstream branching.
