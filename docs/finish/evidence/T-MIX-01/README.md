# T-MIX-01: Audible weight

Closes F-MIX-01, F-MIX-08; probe `P-63-crossfader` (spec 63, DS-26).

## What changed

- `packages/dj-core/src/index.ts` gains the crossfader model: `sideOf` reads
  `mixer.crossfader.assignment`, `crossfaderGain` shapes the position with
  `mixer.crossfader.curve` (source, linear, constant-power, sharp-cut), and
  `deckWeight` combines the channel fader, the gain, the playing state and the
  `mixer.weight.masterBonus` for the master deck. THRU decks ignore the
  crossfader entirely.
- DS-26 is `resolveCrossfader`: software, then controller, then configured,
  with the agreement spread between the provided readings as the comparison
  measurement. `mixer.crossfader.curve: source` means the DJ software already
  applied its own curve.
- `packages/show-mixer/src/index.ts` exposes `deckWeightOf`,
  `baseWeights` and `crossfaderGainOf`, and `mixDown` accepts an explicit
  shared position; without one each deck reports its own software value, which
  keeps both decks audible at centre.

## Proof

- `packages/show-mixer/src/weight.test.ts` (`P-63-crossfader`): hard left
  gives A 1 and B 0, hard right gives A 0 and B 1, the centre follows each
  curve, THRU ignores the crossfader, a custom assignment moves a deck to the
  other side, the master bonus applies on top of the gain, DS-26 resolves in
  order, and a property sweep over the fader is inside [0, 1] and monotone.
- Scoped smoke run this session: the same checks pass against the source.

## Delete test

Go back to `channelFader * crossfader` per deck and the hard-left and
hard-right assertions go red (both decks go silent at the left end). Return
the normalized split in `baseWeights` and the unnormalized assertion in
T-MIX-02 goes red. Remove the assignment lookup and the THRU test goes red.
