# T-SEC-04: Read-only access enforced by construction

Closes F-SEC-02; supports `P-4.1-readonly-library`.

## What changed

- `packages/rekordbox-library/src/driver.ts`: both open paths now verify the
  lock instead of assuming the flags took. `node:sqlite` opens with
  `readOnly: true`, sets `PRAGMA query_only=ON`, then reads `PRAGMA query_only`
  back and fails the open with `driver-failed` when it does not report 1. The
  SQLCipher path does the same after `cipher`, `legacy`, `key`: the key is
  probed through the real reader first (wrong key fails as a SQLCipher error,
  never a silently unreadable handle), then `read_uncommitted=true` (reads see
  committed WAL content without checkpointing; a checkpoint is a write) and
  `query_only=ON` with the same read-back. Nothing else in the file changed.
- `packages/rekordbox-library/src/db.ts`: comment only. States the T-SEC-04
  guarantee the reader relies on (query_only read-back at open, write probe
  for the self check). No behavior change.
- `tools/ast-grep/rules/no-library-write.yml` (new): error rule over the exact
  production sources (`anlz.ts`, `beat.ts`, `db.ts`, `driver.ts`, `index.ts`,
  `options.ts`, `pssi.ts`, `service.ts`, `sidecar.ts`, `watch.ts`,
  `packages/serato/src/index.ts`) matching every node:fs write-shaped call
  (`writeFileSync`, `writeFile`, `appendFileSync`, `appendFile`,
  `copyFileSync`, `copyFile`, `renameSync`, `rename`, `unlinkSync`, `unlink`,
  `rmSync`, `rm`, `mkdirSync`, `mkdir`, `createWriteStream`, `openSync`).
  Tests and `test-fixtures.ts` are outside the file list by construction.
  Note: the first draft used `language: tsx` with `files` globs plus
  `exclude`; `sg scan` stayed silent on a planted `writeFileSync` because
  `tsx` does not match the `.ts` sources (verified: `sg run -l tsx` finds
  nothing, `-l ts` finds it). `language: TypeScript` plus the explicit file
  list fixed it.
- `packages/rekordbox-library/src/readonly.test.ts` (new): six tests. Writes
  rejected through `openReadOnly`, through `RekordboxReader.probeWrite`,
  through the `SidecarReader` transport and through the sidecar protocol;
  the service exposes no write-shaped method (prototype scan plus named
  assertions); the fixture sha256 is identical before and after the full
  read plus probe run.
- `packages/serato/src/readonly.test.ts` (new, tests only, zero source
  edits per Main: SeratoM2 owns `packages/serato/src` sources): four tests.
  Crate parses identically twice with a stable file checksum; corrupt crate
  and BeatGrid payloads throw instead of being repaired in place; Remote to
  DeckState mapping is pure (same snapshot in, same state out, input
  unmutated); no write-shaped export exists.
- Untouched by this slice: the sidecar Python script already opens
  `mode=ro` with `query_only` (verified, not changed); audio and ANLZ reads
  go through `statSync`/`readFileSync` descriptors only (no write call
  exists in production sources, which the new rule now pins); the sibling
  identity module and its test, serato `geob`/`mapping`/`dod` tests, both
  `package.json` dependency lines and the `index.ts` re-export swap in the
  working tree belong to other slices.

## Proof

- `vitest run src/readonly.test.ts` in `packages/rekordbox-library`:
  1 file, 6 passed.
- `vitest run src/readonly.test.ts src/index.test.ts` in `packages/serato`:
  2 files, 11 passed.
- `vitest run src/db.test.ts src/service.test.ts src/index.test.ts` in
  `packages/rekordbox-library` (existing suites, with sibling changes
  present): 3 files, 15 passed.
- `sg scan --config tools/ast-grep/sgconfig.yml --filter no-library-write`:
  clean (exit 0, no findings).
- Rule fires on a planted write: appended
  `export function sec04PlantedWrite(path) { writeFileSync(path, ...) }` to
  `packages/serato/src/index.ts`, the scan reported
  `packages/serato/src/index.ts:124 ... 1 error(s) found`, then restored the
  file (`git status` clean for that path).
- Full `sg scan` baseline unchanged apart from the new rule: only the
  pre-existing `no-magic-number` warnings and `no-string-ipc` warnings
  remain; `no-golden-self-write` and `no-tautological-expect` report zero.
- Typecheck note: `tsc --noEmit` in both packages reports the same
  `TS2591 Cannot find name 'node:*'` errors with and without this slice
  (verified via `git stash` round trip); pre-existing environment issue,
  not introduced here.

## Delete test

- Revert the query_only read-back in either open path and the open either
  throws `refused the query_only lock` (lock off) or behaves as before (lock
  on): the read-back is the only new branch, and the readonly suite pins the
  rejection message on every handle. More directly: revert `attemptWrite` to
  return `{ rejected: true }` unconditionally and the checksum test still
  passes but the three probe tests go red on a writable handle, because they
  assert the rejection comes from SQLite (`/readonly|read-only|query_only/`).
- Delete `tools/ast-grep/rules/no-library-write.yml` and the planted-write
  proof has no rule to fire; add any `writeFileSync` to a listed production
  source and nothing fails until the rule is restored.
- Delete `src/readonly.test.ts` (either package) and a silently writable
  handle passes the remaining suites, because only the new tests checksum
  the fixture and probe every handle.

## Remaining work (not claimed done)

- Serato `_Serato_/database V2` and `SmartCrates` readers do not exist yet
  (T-SER-04 owns them); when they land they must open read-only and they
  fall under the new rule automatically by path.
- The SQLCipher `better-sqlite3-multiple-ciphers` path is not installed in
  this tree, so its read-back is code-reviewed, not executed here; the
  sidecar encrypted-copy test covers the same lock through the interpreter
  where `uv` is available.
- `tools/ratchet.json` and `docs/finish/STATUS.md` belong to the
  orchestrator; this slice adds no ratchet entry itself.
