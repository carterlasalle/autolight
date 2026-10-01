# T-FLX-06: Composite provider integration

Closes F-LIVE-06 (MIDI part). Probe P-10-composite (MIDI from a virtual port,
not a mock).

## What changed

- `packages/controller-flx4/src/integration.ts` (new): the in-process seam
  from the FLX4 decode/state/signal layers into the T-LIVE-07 composite
  provider over a bounded subscription. Consumes the T-FLX-02 deck-aware
  surface (`Flx4Event` from `map.ts`), never raw CC/NOTE values:
  - `feedEventFromDecoded`: structural conversion (deck from the MIDI
    channel via the map; jog deltas as signed velocities; 14-bit pairs only
    when complete). Only transport/fader/loop/pad controls the composite
    consumes map here.
  - `Flx4Feed`: bounded latest-wins queue (S26, capacity 256) with a drop
    counter; `ingestDecoded` converts and enqueues, keeping unknown raw
    messages and incomplete halves (never dropped silently, visible via
    `unknownEvents()`).
  - `driveCompositeFromFeed`: drains the feed into
    `ingestControllerEvent`; returns the drained count.
  - `subscribeServiceToComposite`: production wiring (`service.onEvent`
    into `model.apply`, `derive` per event, feed into composite), returning
    consumed count plus seen signals. Scratch traces stay on the deriver's
    `scratchTrace` for the runtime fold-in (T-FLX-04).
- `packages/controller-flx4/src/integration.test.ts` (new): 12 tests,
  including a recorded 8-message session on real status bytes (LOAD, PLAY,
  tempo/channel/crossfader 14-bit pairs) driven through the real `Flx4Decoder`
  into a stub composite.

## Proof

Scoped runs (2026-10-01):

- `yarn workspace @autolight/controller-flx4 exec vitest run
  src/integration.test.ts`: 12 passed (deck separation by channel with
  identical Data 1, 14-bit monotonic reconstruction, full session to the
  composite, unknown retention with raw bytes, bounded drops, wiring with
  signal capture, audibility confirmation).
- Full package suite `vitest run` in `@autolight/controller-flx4`:
  6 files, 54 tests passed (no regressions in the T-FLX-01 to T-FLX-04
  suites owned by FlxM2Bundle).
- `tsc --noEmit -p tsconfig.json` in the package: clean.

## Delete test

Delete the channel-derived deck in `feedEventFromDecoded` (hardcode deck 1)
and the deck-separation test goes red. Delete the `unknown.push` in
`ingestDecoded` and the unknown-retention test goes red. Delete the
`driveCompositeFromFeed` call in `subscribeServiceToComposite` and the wiring
test goes red (consumed stays 0).

## Seams

- Upstream: `Flx4Decoder` (T-FLX-02), `Flx4StateModel.apply` (T-FLX-03),
  `Flx4SignalDeriver.derive` (T-FLX-04), `Flx4ControllerService.onEvent`
  (T-FLX-01). This file depends on their public methods only.
- Downstream: T-LIVE-07 `CompositeProvider.ingestControllerEvent`.
- T-FLX-02 owns byte meanings; this file owns the conversion. Per Main's
  notice the corrected official Data-1 constants are consumed, never
  redefined here (only `confirmAudible` is imported from `index.ts`).
