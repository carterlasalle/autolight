# T-DATA-02: Schema and migrations

Closes F-DATA-03; probe `P-81-schema`.

## What changed

- `packages/storage/src/migrate.ts` (new): versioned migrations with a
  `schema_migrations` bookkeeping table and a runner that applies pending
  migrations in a transaction each.
  - Migration 1 (`baseline`) is exactly the seven tables the first release
    shipped, so a database written before migrations existed is adopted at
    version 1 instead of being replayed into.
  - Migration 2 (`spec-81-schema`) creates every remaining spec 81 table
    (`source_identities`, `native_analysis`, `analysis_runs`, `show_edits`,
    `device_capabilities`, `device_calibrations`, `fixture_placements`,
    `fixture_groups`, `show_styles`, `protocol_versions`) plus the tables this
    plan owes (`track_aliases`, `analysis_jobs`, `config_values`, `rooms`,
    `room_anchors`, `qualification_records`, `capability_status`), adds the
    missing columns on `tracks`, `venues` and `sessions`, and rebuilds
    `analysis_artifacts` and `show_plans` with the widened cache keys
    (schema version, analyzer and planner version, source fingerprint, style
    hash, venue capability class, config snapshot hash) while copying the
    existing rows. The provenance columns default to `'1'` and empty strings,
    which is the same value the backfill writes for rows from before they
    existed.
  - Downgrades are refused with the current version, the requested target and
    the recommended action in the message.
- `packages/storage/schema.sql`: extended to the full head schema as the
  readable snapshot. `loadSchema()` reads it, and the parity test below fails
  if it ever drifts from what the migrations build. The pragma is gone from the
  file: `driver.ts` applies it from config and reads it back.
- `packages/storage/src/index.ts`: `Store` runs the migrations instead of
  executing the snapshot, and exposes `version`, `pendingMigrations` and
  `tables` from the real database.

## Proof

- `packages/storage/src/migrate.test.ts` (new, 7 tests): the P-81 table list on
  a fresh database, an up test on a database at version 1 with data, adoption
  of a pre-migration database, idempotence, downgrade refusal, rollback of a
  failed migration, and the `schema.sql` parity comparison
  (table by table column signature: name, type, not-null, default, primary key
  position).
- `node_modules/.bin/vitest run --silent=false --reporter=verbose` from
  `packages/storage`: 7 files, 46 tests passed. The P-81 line it prints:
  `P-81: 17 spec-81 tables + 7 plan tables + schema_migrations = 25 tables,
  schema v2`.
- The version 1 to version 2 up test seeds a track, an artifact, a plan, a
  venue and a device, migrates, and reads the rows back with
  `schema_version '1'`, `config_hash ''`, the plan JSON intact and the venue
  layout intact, so "a DB created by the first release migrates to the final
  schema" is proven rather than asserted.
- Simulator runs prove code, never hardware; no hardware claim is made here.

## Delete test

Delete migration 2's `rooms` block and the P-81 test fails on the missing
table. Delete the `adoptLegacyBaseline` call and the pre-migration database
test fails on `adoptedBaseline` and on the expected applied list (`[2]` becomes
the replayed baseline plus the delta). Delete
the `target < from` guard in `migrate()` and the downgrade test stops throwing.
Delete the `schemaShape` comparison and the snapshot in `schema.sql` can drift
from the migrations with nothing going red. Delete the `BEGIN` / `ROLLBACK`
pair and the rollback test leaves a half-migrated database behind.

## Remaining work (not claimed done)

- There are no down migrations by design: a downgrade is refused. If a rollback
  path is ever wanted, it needs its own task and its own tests.
- The widened `analysis_artifacts` and `show_plans` keys are written by the
  callers that own them (`T-DATA-03`, `T-DATA-04` here; `T-ANA-13` for the
  analyzer side).
