# T-FLX-05: Expressive hints for the director and mixer

Closes F-FLX-04.

## What changed

Same new file as T-FLX-06 (`packages/controller-flx4/src/integration.ts`),
hints section; tests in `packages/controller-flx4/src/integration.test.ts`
("expressive hints" block, 6 tests). Controller activity becomes
`ExpressiveHint` events with strength and duration, never direct lighting
(spec 11 "no random reaction"):

- `deriveExpressiveHints` (pure): large filter sweep over
  `flx4.hints.filterWindowMs` (1500 ms, magnitude plus direction);
  pad roll start/stop; channel fader rising on the incoming deck (T-MIX-05
  introduction); loop shrink (halve/double); loop release; EQ bass kill and
  return ("bass re-entry"); transport edges (play/cue/hot cue/load/beat jump).
  The `enabled` list is `flx4.hints.enabled`. Detection labels candidates;
  restraint is enforced at mapping time so tests assert each independently.
- `mapHintToMixer` (pure, advisory): filter sweep to `reduce-density`;
  pad roll to `subdivide-spatial`; fader rise to `advance-intro` with spec 67
  stages (palette/rhythm/impacts); loop shrink to `raise-cadence`; loop
  release to `impact-on-next-beat` with at most one impact per restraint
  window (8 s default, `lastImpactAtNs` proof in tests); EQ kill arms and
  return marks `mark-bass-reentry`; transport to `accent-phrase-change`.
  Every branch maps to a budgeted decision or to `ignore` with the reason
  (deck not audible via `confirmControllerAudible`, restraint window, impact
  not allowed), and each hint records whether it was used: all visible in
  the DJ Event Inspector.
- Director shape (per MixerDirector): `fader-rise` and `filter-sweep` carry
  channel plus value, `transport` carries string control plus `on`; extended
  kinds (`loop-change`, `roll`, `eq-kill`) travel the same channel and are
  ignored by consumers that only know the three director kinds. Structural
  match, no package import needed on the consumer side.

## Proof

- Same scoped run as T-FLX-06: 12 integration tests passed, including one
  test per hint (filter sweep magnitude, fader-rise stages, shrink cadence,
  release restraint with a second release inside the window ignored, kill
  arming plus re-entry, roll subdivision, silent-deck ignore).
- A director test showing a loop release yields at most one impact per
  restraint window: the "marks loop shrink cadence and at most one impact"
  test maps two releases 1 s apart with the first as `lastImpactAtNs` and
  asserts the second maps to `ignore`/`used: false`.

## Delete test

Delete the restraint-window check in `mapHintToMixer` and the loop-release
test goes red (second release maps to impact). Delete the audibility gate
and the silent-deck test goes red. Delete the 0.4 sweep threshold in
`deriveExpressiveHints` and the small-move test goes red.

## Seams

- Hints flow to the adaptive director (T-RUN-09) and the mixer, which decide
  with restraint (T-PLAN-05 budgets apply to live decisions too). This module
  never emits lighting and never enforces the mixer clock; `impactAllowed`
  and `lastImpactAtNs` are owned by the mixer via `MixerHintContext`.
