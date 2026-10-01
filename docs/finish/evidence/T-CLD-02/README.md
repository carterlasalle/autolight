# T-CLD-02: Cloud cross-check in qualification

Closes F-CLD-01 (qualification half). Spec 148 (cloud never for frames).

## What was built

- `src/cross-check.ts` in `packages/cloud/`: when cloud metadata is enabled,
  qualification compares the cloud-declared segment count with the measured
  count and records any mismatch in the device evidence. The measured value
  always wins: the declaration is a hint that flags a record for review,
  never a value written into the calibration. Outcomes are `agree`,
  `disagree` (mismatch recorded with both counts in the evidence note), and
  `cloud-silent` (entry claims no count, or no cloud record at all).
- The client parser feeds it: `parseDeviceEntry` returns
  `declaredSegmentCount: null` when the entry claims none, so silence and
  disagreement stay distinct.

## What passes today vs what waits

- Passes today: 5 tests in `packages/cloud/src/cross-check.test.ts`:
  disagree recorded with measured kept, agree silent, silent entry keeps
  measured, absent cloud keeps measured, direct comparison unit cases.
- Waits on the qualification wizard binding (T-GOV-11 record shape) and the
  device screen mismatch surface (UI slice); the outcome object carries
  everything both need.

## Proof

- `yarn workspace @autolight/cloud test`: 2 files, 16 tests passed
  (5 cross-check plus 11 client).
- `yarn workspace @autolight/cloud typecheck`: clean.
- Red run: reducing `crossCheckQualification` to always agree makes 3 tests
  red (disagree, cloud-silent entry, absent cloud).

## Delete test

Delete `packages/cloud/src/cross-check.ts` and the cross-check tests fail
to import. Revert `compareDeclaredSegments` to agree-always and the
disagree and silence tests go red.

## Remaining seams

- Wizard step wiring and the tile mismatch badge belong to T-GOV-11 and the
  UI slice; this outcome is the contract they bind to.
