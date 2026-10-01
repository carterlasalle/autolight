# T-ID-02: Planner seed from the fingerprint

Closes F-ID-02. Probe P-27-seed-fingerprint. Spec 27.

## What was wrong

The planner seed was the database row ID (`seedFor(track.identity.id, ...)`),
not the fingerprint spec 27 requires; docs claimed fingerprint while code
used the ID. Two copies of the same track planned differently.

## What changed

- `packages/track-identity/src/seed.ts` (new): `derivePlannerSeed(input,
  plannerVersion, styleId)` with fallback fingerprint, fileHash, then native
  ID flagged `seedSource: "native-id-weak"` plus `weak: true`. The plan
  records `seedSource`, so Diagnostics shows weak seeds. Same fingerprint
  with different database IDs gives byte-identical seeds: the fingerprint is
  the only identity input.
- Seam to PlannerM3: `derivePlannerSeed` is the injected fingerprint
  resolver for `CompileInput`; `plan.determinism` records fingerprint,
  fingerprintSource, planner/style/venue/config hashes and seed. The legacy
  `showPlanSchema` gains no field here (contracts is outside this slice).

## Proof

- `yarn workspace @autolight/track-identity test`: the T-ID-02 block
  asserts identical seeds for fingerprint `fp-1` under native IDs `101`
  and `999`, the fileHash fallback source, and the weak native-ID flag.
- Failing-capable: seed from `nativeId` first and the identical-seed test
  goes red; drop the `weak` flag and the fallback test cannot distinguish
  a fingerprinted seed from a guess.

## Delete test

Delete `src/seed.ts` and the T-ID-02 block fails to import. Reintroduce
`seedFor(identity.id)` as the plan seed and the same-fingerprint test
names the regression.

## Seams

- PlannerM3 wires `derivePlannerSeed` as the injected resolver and records
  `seedSource` in `plan.determinism`; contracts owner adds any schema field.
