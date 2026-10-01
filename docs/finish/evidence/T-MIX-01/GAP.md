# T-MIX-01: Audible weight (gap close)

Closes F-MIX-01, F-MIX-08; probe `P-63-crossfader` (spec 63, DS-26). Wave 1
built this task (evidence `docs/finish/evidence/T-MIX-01/README.md` stands);
this note records only the gap review this slice performed, no rewrite.

## Gap review

- Re-read `deckWeightOf`/`baseWeights`/`crossfaderGainOf` in
  `packages/show-mixer/src/index.ts` against the DoD: hard left gives A 1 and
  B 0, hard right gives A 0 and B 1, centre follows the curve, THRU ignores
  the crossfader, master bonus applies, DS-26 resolves in order. All present.
- One real gap found and closed elsewhere, not here: the adaptive director
  needed the same weight contract for its energy input, and the new
  `packages/show-director` documents that it reads mixer weights without
  re-implementing them. No mixer source changed.
- No other gaps: monotone sweep, [0, 1] range, unnormalized weights, and the
  shared-position versus own-reading behavior are all covered by
  `packages/show-mixer/src/weight.test.ts`.

## Proof

- `yarn workspace @autolight/show-mixer test`: 8 files, 47 tests passed
  (includes `weight.test.ts`, plus QualM6's new `weights.property.test.ts`).
- No mixer source edited by this slice; `git status` shows no modifications
  under `packages/show-mixer/src/index.ts`, `blend.ts`, or the wave-1 tests.

## Delete test

Unchanged from the wave-1 evidence: back to `channelFader * crossfader` per
deck and the hard-left/hard-right assertions go red; normalize `baseWeights`
and the T-MIX-02 lone-deck assertion goes red.
