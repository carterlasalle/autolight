# T-MIX-04: Transition-aware blackout translation

Closes F-MIX-03, F-QA-09; probe `P-66-translate-all` (spec 66, DS-18).

## What changed

- `blackoutDecision` translates a deck's blackout, including the planner's
  `ALL` target, while another deck is audible above
  `mixer.blackout.otherDeckThreshold`. Every DS-18 mode is implemented:
  `full` (keep), `deck-spatial-dip`, `deck-side-blackout` (the firing deck's
  side of the room from the WP05 splits) and `global-partial-dip`.
- `auto` keeps the full blackout only when both tracks structurally support it
  (both at a pre-drop or both at a section end) and otherwise chooses by the
  other deck's weight: a side blackout above 0.8, a global dip from 0.5, a
  spatial dip above the threshold.
- The old `SIDE` target and its test are deleted; `MixResult.dropped` and the
  decision reason record every translation for the DJ Event Inspector.
- The translated dip's intensity is the light that remains, and the renderer
  treats a dip as a linear-light multiply (T-REND-01).

## Proof

- `packages/show-mixer/src/blackout.test.ts` (`P-66-translate-all`): the input
  is a planner-produced `ALL` blackout (`planShow` on a model with a fake
  drop), the other deck sits at 0.8, and each DS-18 mode has its own
  assertion; the auto ladder, the structural case and the threshold case are
  covered, and no translation produces a `SIDE` target.
- `packages/show-mixer/src/index.test.ts` keeps the helper-level check.
- Scoped smoke run this session: the whole mode table passes against the
  source.

## Delete test

Re-add the `cue.target === "ALL"` exemption and every translation test goes
red. Remove the structural check from `auto` and the both-pre-drop case stops
returning a full blackout. Swap the room halves in `deckSideTarget` and the
deck B assertion goes red.
