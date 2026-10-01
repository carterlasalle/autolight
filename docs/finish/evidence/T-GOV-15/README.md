# T-GOV-15: Segment resolution selection

Closes F-GOV-28. Spec 53, DS-20. Builds on the T-GOV-11 wizard step 9 record
(counted bands and the changepoint sweep) and the T-GOV-13 rate helper.

## What was built

- `packages/govee/src/resolution.ts` (new): `selectResolution()` over
  logical (app-exposed, confirmed per unit), grouped (largest proper divisor
  first, or an explicit candidate list) and native (measured N). `auto`
  picks the highest confirmed count whose stable fps meets
  `govee.lan.stream.targetHz`; when nothing meets it, auto falls back to
  the most stable candidate and says the native count was too slow. The
  decision returns the candidate table plus a one-line reason the UI shows.
- Re-exported from `packages/govee/src/index.ts`.

## What passes today vs what waits

- Passes today: 4 tests in `packages/govee/src/resolution.test.ts`
  (native meets target; native 120 too slow so auto picks grouped 40 with
  the reason naming both; explicit native below target labelled explicit;
  empty input and a mode with no count throw).
- Waits on the UI: showing the reason per device (T-UI-08/10); waits on
  hardware: the wizard steps 9 and 13 that fill logical, native and the
  stable fps per unit.

## Proof

- `yarn workspace @autolight/govee vitest run src/resolution.test.ts` :
  4 tests passed; full govee slice run
  (`resolution firmware scenes metrics profiles probe actions
  qualification`) : 40 tests passed.
- `yarn workspace @autolight/govee tsc --noEmit -p tsconfig.json` : clean.
- Red run: change the grouped divisor order or delete the below-target
  fallback and the grouped test goes red; pass `native: null` with no
  logical and the throw test goes red.

## Delete test

Delete `packages/govee/src/resolution.ts` and every resolution test fails
to import. Remove the native-too-slow branch and the grouped test goes red.
