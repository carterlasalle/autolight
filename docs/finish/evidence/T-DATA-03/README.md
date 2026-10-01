# T-DATA-03: Cache versioning and selective invalidation

Closes F-DATA-03; probe `P-82-invalidation`.

## What changed

- `packages/storage/src/cache.ts` (new): the spec 82 cache keys and the per-rule
  invalidation.
  - `artifactKey` and `planKey` build the database key tuples: schema version,
    analyzer version, planner version, source fingerprint, style hash, venue
    capability class hash and config snapshot hash. `artifactFresh` and
    `planFresh` answer whether a row is still valid for a requested key.
  - Hashes are stable: `stableHash` canonicalizes objects with sorted keys, so
    `configSnapshotHash` and `venueClassHash` do not depend on insertion order,
    while `sourceFingerprint` covers path, size, rounded mtime and an optional
    content hash.
  - `invalidate(db, rule)` executes exactly one rule and reports what it
    deleted, what it reused and why:
    - `analyzer`: deletes analysis artifacts and runs whose analyzer version
      differs, keeps TrackModels from the library, plans and `native_analysis`.
    - `planner`: deletes plans from other planner versions, reuses TrackModels.
    - `venue`: deletes nothing, because the venue class re-keys plan lookups and
      the renderer adapts a semantic plan.
    - `style`: deletes plans for the changed style only.
    - `library`: deletes only the changed track's derived rows for other source
      fingerprints (T-RBL-06), leaving other tracks alone.
    - `config`: deletes plans built under another config snapshot.
- The widened keys land in the schema through `T-DATA-02` migration 2, and the
  fast path in `T-DATA-04` reads them.

## Proof

- `packages/storage/src/cache.test.ts` (new, 9 tests): one test per rule
  asserting the exact deleted counts and that the rows the rule must keep are
  still readable (`loadArtifact`, `loadShowPlan`, the track row, a second
  track's artifact), plus key stability, per-part sensitivity (analyzer,
  planner, style hash, venue class, config hash, fingerprint, size, path,
  content hash) and the freshness predicates.
- `node_modules/.bin/vitest run --silent=false --reporter=verbose` from
  `packages/storage`: 7 files, 46 tests passed.
- The invalidation tests are exact-count, not "something was deleted": the
  analyzer rule reports `{ analysis_artifacts: 1, analysis_runs: 1 }` with two
  artifacts seeded, and the venue rule reports `{}` with everything still
  present, which is the "observe exactly which rows are invalid" wording of the
  DoD.
- Simulator runs prove code, never hardware; no hardware claim is made here.

## Delete test

Delete the `analyzer` branch's `DELETE` and its test fails on the deleted
counts while the plans it must keep still load. Delete the `venue` rule's
empty delete and the test fails on `{}`, which is the point of the rule.
Delete the `style_id = ?` predicate from the style rule and the club plan
disappears too, failing that test. Delete the `fingerprint <> ?` predicate from
the library rule and the second track's artifact is deleted as well. Delete the
`config_hash` component from `planKey` and the key-sensitivity test fails, so a
config change could silently reuse a plan.

## Remaining work (not claimed done)

- Nothing calls `invalidate` from the app yet: the analyzer and library watcher
  tasks (`T-ANA-13`, `T-RBL-06`) own the call sites. The rules and their tests
  are here so those tasks wire a proven function.
- Invalidation for a *removed* library track (not just a changed fingerprint)
  is the watcher's contract and is not implemented here.
