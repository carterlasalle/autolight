# T-RBL-01: Rekordbox library readers behind DS-15

Closes F-RBL-01. Spec 4.1, 110 (read-only), 138.

## What was wrong

Nothing opened `master.db` at all: no key derivation, no read-only handle, no
reader modes. The library plane existed only as three helper functions.

## What changed

- `packages/rekordbox-library/src/options.ts` derives the SQLCipher key the way
  pyrekordbox and rekordbox-connect do (base85, XOR, zlib inflate of the
  published blob; the `dp` route from `options.json` goes through
  rekordbox-connect's decryptor when the dependency is installed). It also
  carries the per-OS `options.json` / `db` / `share` layout. The key is never
  logged, never returned in diagnostics; only `keySource` is reported.
- `src/driver.ts` opens the database read-only through two drivers behind one
  interface: `node:sqlite` with `readOnly: true` plus `PRAGMA query_only=ON`,
  and `better-sqlite3-multiple-ciphers` with the SQLCipher pragmas and
  `read_uncommitted=true` so a reader sees Rekordbox's committed WAL content
  without ever checkpointing (a checkpoint is a write). No handle exposes a
  write method; `attemptWrite` is the only write entry point and exists solely
  for the read-only self check.
- `src/db.ts` reads tracks (joined artist, album, genre, key and colour), every
  remaining column retained as `raw` (spec 9.5), playlists with folders, history
  sessions with their songs, track IDs and paths, plus the database format
  version from `djmdProperty`.
- `src/sidecar.ts` is the second DS-15 reader: the analysis worker (uv) runs a
  read-only `library-read` script over `sqlcipher3` (`mode=ro` URI plus
  `query_only`), returning the same raw rows so `mapTrackRow` produces identical
  normalized output.
- `src/service.ts` combines them: `rekordbox-connect` authoritative,
  `pyrekordbox` when the TypeScript reader cannot open the database, and `auto`
  (default) which falls back on a typed failure and cross-checks row counts,
  playlist membership and sample ANLZ paths for Diagnostics.
- `packages/rekordbox-library/package.json` declares `rekordbox-connect`
  (hard), `better-sqlite3-multiple-ciphers` and `@parcel/watcher` (optional, not
  installed in this tree) and `@types/node`. The SQLCipher module is native:
  add it to the Electron rebuild list in T-OPS-05.

## Proof

- `node_modules/.bin/vitest run` in `packages/rekordbox-library`: 9 files, 54
  passed, 1 skipped (owner library, opt in).
- Read-only: `src/db.test.ts` opens the fixture and asserts
  `reader.probeWrite().rejected === true` with SQLite's own
  "attempt to write a readonly database"; `src/sidecar.test.ts` asserts the
  same through the sidecar handle on the plain fixture and on a SQLCipher copy
  of it.
- Row-count agreement between readers: `src/sidecar.test.ts` compares counts,
  `dbVersion` and every normalized `LibraryTrack` between the TypeScript reader
  and the pyrekordbox interpreter on the same fixture (`pyTracks` deep-equals
  `tsTracks`).
- Encrypted path: the fixture is exported to SQLCipher with the derived key; the
  sidecar reads it and rejects a write, and the TypeScript reader either opens it
  (when the cipher module is present) or reports `cipher-module-missing` so the
  service falls back, which `src/service.test.ts` exercises in `auto` mode.
- Owner library (HW-RB-LIB-01 local counterpart), run with
  `AUTOLIGHT_OWNER_LIBRARY=1`:
  `{"tracks":847,"playlists":6,"historySessions":33,"historyEntries":353}`
  `dbVersion=6000`; one sample track resolved to
  `/PIONEER/USBANLZ/1ad/75cdf-9981-4feb-87c4-9d44678c3bde/ANLZ0000.DAT` with
  statuses `["audio-missing","anlz-ok"]`.

## Delete test

Delete `src/test-fixtures.ts` and every fixture-driven assertion in
`src/db.test.ts`, `src/service.test.ts` and the interpreter half of
`src/sidecar.test.ts` goes red. Unset `AUTOLIGHT_OWNER_LIBRARY` and the owner
case skips, so the real-library counts above must be reproduced by hand.

## Hand-offs (outside this slice)

- `analysis/src/autolight_analysis/worker.py` does not yet own the
  `library-read` op; the contract is the JSON on stdin and one JSON object on
  stdout implemented in `src/sidecar.ts` (`SIDECAR_SCRIPT`). Moving the script
  into the worker and pointing `DEFAULT_SIDECAR_COMMAND` at it is a two-line
  change for the analysis package owner.
- `THIRD_PARTY_NOTICES` needs the `rekordbox-connect` (MIT) and
  `@parcel/watcher` (MIT) entries; generating that file is not in this slice.
- `T-OPS-05` Electron rebuild list needs `better-sqlite3-multiple-ciphers`.
