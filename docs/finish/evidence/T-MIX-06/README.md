# T-MIX-06: One path to pixels

Closes F-MIX-04, F-MIX-05, F-APP-07, F-UI-05 (data); probes `P-62-two-worlds`,
`P-65-no-leak` (spec 62, 65).

## What changed

- A cue reaches a frame only through `mixDown` and `renderFrame` in the show
  host: `MixResult` carries the surviving cues, the layer grouping, the blend
  space and the drop reasons, and the renderer composites them. There is no
  second path that paints a cue directly.
- The UI's upcoming cues come from the show host snapshot:
  `upcomingCues` computes them from the deck's own plan and beat with the real
  durations, intensities and priorities, so two decks at different beats get
  their own lists.
- The dependency-cruiser rule `renderer-no-show-internals` already forbids
  `apps/desktop/src` from importing the mixer, the runtime, the renderer or
  the Govee package.

## Proof

- `packages/show-mixer/src/owner.test.ts` (`P-65-no-leak`): a non-owner white
  hit changes no pixel because the mixer never passes it on.
- `packages/show-runtime/src/runtime.test.ts` (`P-62-two-worlds`): two worlds
  evaluate independently and the upcoming-cue list is per deck and per beat.
- Scoped smoke run this session: both checks pass, and the untouched show host
  publishes snapshots from this path.

## Delete test

Add a renderer call that takes cues straight from a plan and the no-leak test
goes red. Compute the upcoming list from the renderer's own cursor again and
the per-deck beat test goes red.
