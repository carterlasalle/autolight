# T-DATA-01: Storage service and drivers (DS-06)

Closes F-DATA-01, F-DATA-02, F-APP-15; probe `P-80-db-open`.

## What changed

- `packages/storage/src/driver.ts` (new): the DS-06 driver policy. `openDatabase()`
  applies `PRAGMA journal_mode = WAL` and reads the mode back (a file database
  that does not report `wal` throws instead of running with an inert pragma),
  then `synchronous` (from `storage.sqlite.synchronous`, validated against OFF,
  NORMAL, FULL, EXTRA), `busy_timeout` (from `storage.sqlite.busyTimeoutMs`) and
  `foreign_keys = ON`, each verified by reading the pragma back. `auto` prefers
  better-sqlite3 and falls back to the built-in node:sqlite, reporting
  `chosen`, `fellBack` and `fallbackReason` as visible status; a driver that is
  requested explicitly and cannot open throws rather than being swapped. Module
  loading works in plain ESM, in the esbuild CommonJS bundle of the Electron
  main process and in a worker (`process.getBuiltinModule`, the bundle's
  `require`, then `createRequire`); a top level `createRequire(import.meta.url)`
  throws at bundle load, which the smoke run below proved.
- `apps/desktop/electron/services/storage-service.ts` (new): opens
  `app.getPath("userData")/autolight.db` (`AUTOLIGHT_USER_DATA_DIR` wins so the
  E2E harness can pin a temp profile), runs the migrations, records the
  open-time state (driver, journal mode, synchronous, busy timeout, foreign
  keys, schema version, pending migrations, table count) and exposes `name`,
  `start()`, `stop()`, `close()`, `status()` and `statusLine()`. The spec 80
  self-test loads `node:sqlite` and records `process.versions.node` and
  `process.versions.electron` next to the result.
- `apps/desktop/electron/main.ts`: opens the service right after
  `applySessionHardening()` (spec 132 stage 2, the first stage of
  STARTUP_ORDER) and logs `statusLine()`; closes it on `will-quit` so the
  checkpoint lands before exit.
- `apps/desktop/electron/show-service.ts`: the stale "Electron 33's Node lacks
  node:sqlite" comment (F-APP-15) is deleted; it points at the storage service,
  which is where the database now lives (the repo depends on Electron
  `^41.10.6`).

## Proof

- `packages/storage/src/driver.test.ts` (new, 6 tests): WAL read-back plus the
  `-wal` sidecar after a write, every pragma read-back, driver status with the
  fallback reason, driver parity, invalid config values, an explicitly
  requested driver that cannot open, and `:memory:`.
- `node_modules/.bin/vitest run --silent=false --reporter=verbose` from
  `packages/storage`: 7 files, 46 tests passed. The P-80 line it prints:
  `P-80: driver node-sqlite, fell back from better-sqlite3 (Cannot find module
  'better-sqlite3'), node 22.22.2, electron none, journal wal, synchronous
  NORMAL, busyTimeout 4000 ms, foreignKeys true`, and
  `driver parity exercised: node-sqlite`.
- The bundled path is a smoke run, not an assumption: an esbuild bundle
  (`--format=cjs --external:electron`, the flags `scripts/build-main.mjs` uses)
  that imports the service and points `AUTOLIGHT_USER_DATA_DIR` at a temp dir
  prints `db /tmp/.../autolight.db, driver node-sqlite, fell back from
  better-sqlite3, journal wal, synchronous NORMAL, busyTimeout 5000 ms,
  foreignKeys on, schema v2, 25 tables`, lists the sidecars
  `autolight.db, autolight.db-shm, autolight.db-wal`, completes a fast-path
  round trip (`miss null, track smoke-track, 1.324 ms`) and reports `closed ok`.
  The first two attempts crashed at bundle load (`createRequire(undefined)`,
  then `new URL("../schema.sql", undefined)`), which is what drove the defensive
  loader and the lazy schema path in `packages/storage/src/index.ts`.
- `apps/desktop` service test through the real API (T-ARC-05 suite):
  `vitest run src/app/services.test.ts -t "storage-service"` gives 1 passed
  (open, status, store round trip, close, singleton cleared).
- Types: `tsc --noEmit -p tsconfig.json` in `packages/storage` clean; the
  `apps/desktop` typecheck reports no error in storage-service.ts, main.ts or
  show-service.ts.
- Simulator runs prove code, never hardware; no hardware claim is made here.

## Delete test

Delete the WAL read-back check in `openDatabase` (the `journal_mode !== "wal"`
throw) and the file-database test fails, because a database that silently stays
in journal mode `delete` passes today only through that check. Delete the
pragma read-backs and the `busyTimeout 4000` / `foreignKeys` / `synchronous`
assertions go red. Delete the better-sqlite3 branch and the visible-status test
fails as soon as the module is installed, since `fellBack` can no longer be
true. Delete `apps/desktop/electron/services/storage-service.ts` and `main.ts`
fails to import and the T-ARC-05 storage-service test goes red; remove
`openStorageService()` from `main.ts` and the app never opens
userData/autolight.db, which is what F-DATA-01 and P-80 are about.

## Remaining work (not claimed done)

- better-sqlite3 and kysely are not installed in this environment and
  dependency changes sit outside this slice's owned paths, so `auto` reports
  the node:sqlite fallback with its reason. The orchestrator step is the spec's
  `yarn workspace @autolight/storage add better-sqlite3 kysely` plus the
  Electron ABI rebuild; after it the parity test covers both drivers and P-80
  reports the better-sqlite3 driver line. The query layer is a thin SQL seam
  (`SqlExec` in driver.ts) that a Kysely `SqliteDialect` wraps in one file when
  kysely lands.
- P-80 from the packaged build belongs to T-OPS-05 and T-TRU-11; the bundle
  smoke run here is the closest proof available in this slice.
- `packages/storage/package.json` does not declare `@autolight/contracts`,
  which `fastpath.ts` imports at runtime for TrackModel and ShowPlan
  validation, nor the test-only workspace packages (`@autolight/govee`,
  `@autolight/ipc`, `@autolight/renderer`, `@autolight/show-planner`,
  `@autolight/simulator`, `@autolight/dj-core`); they resolve through
  workspace hoisting today.
