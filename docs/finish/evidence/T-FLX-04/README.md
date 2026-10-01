# T-FLX-04: Transport-relevant signals for the runtime

Closes the runtime part of F-FLX-03 and the controller part of F-LIVE-12.
Spec sections 11, 61, 63.

## What changed

- `packages/controller-flx4/src/signals.ts` (new): `Flx4SignalDeriver` turns
  decoded events plus the state snapshot into typed signals, each carrying
  `atNs`, `quality` and the fixed `source: "controller"` label so the fusion
  provider only uses them where no DJ-software source supplies the field or to
  confirm one (spec 11).
  - Scratch (spec 61): a jog trace produces `scratch-start` and
    `scratch-end` only when the platter is touched and the direction
    reversals inside the one second window reach
    `runtime.scratch.minReversalsPerSec`; a touch with fewer reversals, or a
    steady reverse, produces no scratch signal. `scratchTrace(state, deck)`
    returns the reversal timestamps (`bigint` Ns) and direction, which is the
    exact input the runtime's `ScratchState.reversals` consumes.
  - `cue-hold` on the CUE button, `hot-cue` with the pad number,
    `pad-press`/`pad-release` for the other pad modes, `loop-in`, `loop-out`,
    `loop-halve` and `loop-double` (with the resulting beat length when the
    state knows it), `loop-exit` versus `reloop` from the last observed loop
    state, `beat-loop` and `beat-jump` with their beat counts (SHIFT beat
    jump pads use the 16x factor), `sync` with the enabled and master flags,
    `load` per deck, `fader` and `crossfader` with the normalized value the
    mixer consumes (DS-26 controller source).
  - Pad roll: on Serato DJ Pro/Lite the SHIFT layer of the PAD FX1 key is
    Roll mode and holding a pad plays a loop roll (DDJ-FLX4 instruction
    manual, "Using Roll"); on rekordbox the same layer is Pad FX 2. The
    deriver emits `pad-roll-start` and `pad-roll-stop` for pads in the pad
    FX 2 range only when the live DJ software is Serato, and `pad-press` for
    rekordbox. The roll length per pad is a DJ-software setting and is not
    sent over MIDI, so `beats` is null rather than invented.

## Proof

- `packages/controller-flx4/src/signals.test.ts`, 8 tests:
  `raises a scratch only for a jog trace with reversals` (two reversals give
  a start and an end, both `estimated`, with the two reversal timestamps);
  `does not claim a scratch from a single reversal or a steady reverse`;
  `emits the runtime scratch trace with reversal timestamps`;
  `carries cue holds, hot cues and pad rolls with their pad numbers`
  (including the Serato roll pair and the rekordbox-negative case);
  `carries loop, beat loop and beat jump lengths` (8 beat loop, halve,
  double, exit, 1 beat and 128 beat jumps);
  `reloops through the same button when the loop is off`;
  `publishes sync toggles, faders and loads as secondary truth` (sync and
  master, fader value 8192/16383, crossfader 0, load);
  `marks the deck for deck 2 pads and faders`.
- `docs/finish/evidence/T-FLX-04/green-run.txt`: the package run with these
  8 tests passing inside 42 tests in 5 files, plus a scoped typecheck with
  zero diagnostics.
- The runtime join: `packages/show-runtime/src/index.ts` folds reversals into
  `ScratchState.reversals` and `scratchDetected` decides the hold;
  `P-61-scratch` in `packages/show-runtime/src/runtime.test.ts` already
  passes for a jog trace with reversals (see
  `docs/finish/evidence/T-RUN-05/README.md`). This package does not import
  show-runtime (the runtime owns that state and the layering is one way);
  the composite provider (T-FLX-06) appends `scratchTrace(...).reversalNs`
  to the runtime's scratch state, which is the only wiring the join needs.

## Delete test

Raise the reversal threshold by removing the `recent.length >=
this.minReversals` check and `does not claim a scratch from a single reversal
or a steady reverse` reddens. Drop the `djSoftware === "serato"` gate and the
rekordbox-negative assertion reddens. Remove the loop-exit action lookup and
`reloops through the same button when the loop is off` reddens. Remove the
SHIFT beat jump factor and the 128 beat assertion reddens. Return `estimated`
for fader signals and the observed-quality assertions redden.

## Seams

- The composite provider (T-FLX-06) owns the fold-in into the runtime and
  into the fusion provider; this slice publishes the signals and the trace.
- Tentative signals are exactly what `quality: "estimated"` says: a loop
  button press is not proof of a loop, and the roll layer on rekordbox is
  Pad FX 2, so the roll signal is Serato-only by design.
- The HW-FLX-02 research probe (whether Rekordbox LED feedback can be
  observed without a driver as a confirmation input) belongs to the WP15
  runbook; nothing here depends on its outcome.
