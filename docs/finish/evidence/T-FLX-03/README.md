# T-FLX-03: Controller state model

Closes the state part of F-FLX-03. Spec sections 10, 11.

## What changed

- `packages/controller-flx4/src/state.ts` (new): `Flx4StateModel` applies
  decoded events and exposes `snapshot()`, a read-only deep copy with
  timestamps and quality labels.
  - Per deck: play and cue button state, SHIFT, active pad mode with its
    timestamp, pads currently down, last observed loop state with the action
    and beat length, sync (enabled and master), jog (touched, last velocity
    and direction, reversal timestamps inside a one second window, and
    `scratchActive` when the reversals reach
    `runtime.scratch.minReversalsPerSec`), tempo fader position, channel
    fader, trim, EQ high/mid/low, CFX, and the LOAD counter for the deck.
  - Mixer: crossfader, master level, headphone mix and level, per-deck
    headphone cue, FX level/depth, Smart CFX and Smart Fader.
  - Quality: hardware-reported values (faders, knobs, pads, jog touch, cue
    button) are `observed`; anything inferred from button presses (play,
    sync, master, loop active, loop length) is `estimated`, per spec 11
    secondary truth. Every button state carries its own timestamp.
  - Tempo mapping: `TempoRangeFit` fits `pitch = (position - 0.5) * 2 * range`
    by least squares over provider samples; it needs at least three samples, a
    travel spread of 0.2 or more, and a residual at or below 0.5 percent, and
    `resolveTempoRange` resolves `flx4.tempoRange` as the fixed 6, 10 or 16
    percent setting, or the fitted value for `source`. `wide` and `source`
    without samples resolve to unknown because MIDI cannot report them.

## Proof

- `packages/controller-flx4/src/state.test.ts`, 10 tests:
  `follows LOAD, PLAY, jog touch and release with timestamps and quality`
  (the sequence the task names, including the reversal timestamp),
  `toggles play, sync and master from button presses`,
  `keeps SHIFT, pad mode and pressed pads`,
  `records loop state with beat lengths from the beat-loop pads` (2 beats,
  halved to 1, doubled to 2),
  `tracks loop in and out, exit, and reloop on the same button`,
  `keeps mixer state from 14-bit pairs`,
  `hands out snapshots that do not alias the model`,
  `recovers the range from a simulated provider within 0.5 percent` (true
  range 10, fitted within 0.5, residual at or below 0.5),
  `refuses underdetermined and noisy samples` (two samples, flat travel and a
  three percent injection all rejected), and
  `resolves fixed settings and leaves source and wide to the fit`.
- `docs/finish/evidence/T-FLX-03/green-run.txt`: the package run with these
  10 tests passing inside 42 tests in 5 files, plus a scoped typecheck with
  zero diagnostics.

## Delete test

Remove the reversal window filter (`atNs - ns <= windowNs`) and the jog
scratch state test reddens. Drop the `estimated` label from inferred values
and the play, sync and loop assertions go red. Remove the residual gate in
`TempoRangeFit.fit` and `refuses underdetermined and noisy samples` reddens
(the injected three percent noise would fit). Return the model's own objects
from `snapshot()` instead of copies and `hands out snapshots that do not
alias the model` reddens. Delete the shift-layer loop factor in `applyPad`
and the halve and double assertions redden.

## Seams

- Provider pitch samples are supplied by the DJ-software provider (WP07);
  this package only consumes them. Showing the fitted range in Settings is UI
  work (WP13).
- Positions are normalized 0 to 1 as sent; the Rekordbox tempo range setting
  is not visible in MIDI, so `resolveTempoRange` reports unknown rather than
  guessing a percentage.
