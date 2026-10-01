# T-SER-04: Serato library, crates, smart crates and watcher

Closes F-SER-06.

## What changed

- `packages/serato/src/library.ts` (new), read-only by construction:
  - `readSeratoDatabase(root)`: field values come from serato-connect's
    `parseDatabaseSync`; a retention walk next to it keeps the raw bytes of
    every tag the model does not carry (spec 9.5), keyed by file path, and
    reports `retainedTagCount`.
  - `readSeratoCrates(root)`: `Subcrates/*.crate` in name order through
    serato-connect's `parseCrateSync`, so crate track order is preserved.
  - `readSeratoSmartCrates(root)` and `evaluateSmartCrate(crate, rows)`: the
    `.scrate` container is walked with the same tag plus big-endian length
    records as the other Serato files. A record whose payload decodes as
    `<field> <operator> <value>` (artist, title, album, genre, key, bpm,
    length, filepath; `is`, `contains`, `equals`, `>=`, `<=`, `>`, `<`) is a
    rule this build evaluates; every other record is kept raw and counted as
    unsupported, so the UI can say "this crate uses a rule layout this build
    does not know" instead of showing an empty crate. All rules must match
    (Serato smart crates are conjunctions).
  - `detectSeratoRoots`: the configured `library.serato.root` first, then the
    default `~/Music/_Serato_`, then every mounted volume that carries its own
    `_Serato_`; `mergeSeratoRows` merges them and keeps the first row for a
    duplicate path.
  - `seratoWatchFiles` and `createSeratoWatcher`: the DS-35 watcher machinery
    from `packages/rekordbox-library` (the same engines T-RBL-06 uses) with
    Serato's file classes. The database and both crate folders are row-level;
    each track's audio file is watched with its own `trackId`, so one changed
    track invalidates only that track's artifacts.
- `packages/serato/src/test-fixtures.ts` (new): the library generator. It
  writes `database V2`, `.crate` and `.scrate` files that serato-connect's own
  parsers accept, so the fixture can never drift from the format the reader
  uses. Tests generate into a temp directory; nothing is hand-edited.

## Proof

- `cd packages/serato && yarn vitest run src/library.test.ts`: 8 tests passed.
  The generated library parses completely (3 rows, title, artist, album,
  genre, BPM), one unmodelled tag survives as raw bytes, crate order is
  `["/music/house-b.mp3", "/music/house-a.mp3"]`, the `genre is House` rule
  matches exactly the two House rows while an unknown record is counted
  unsupported, `bpm <= 124` matches two rows numerically, an external-drive
  root is discovered and its rows merge, and a configured root wins.
- Watcher: a changed audio file reports exactly that file and invalidates
  `audio-derived` plus the derived artifacts; a changed database reports only
  `row` (no native analysis, no model, no plan).
- Read-only: SHA-256 of the database, one crate and one smart crate are
  unchanged after reading all three; `readonly.test.ts` (T-SEC-04 side) also
  asserts the module surface still exposes no write-shaped export.

## Delete test

Delete the retention walk and the raw-tag assertion goes red. Delete the
per-track `trackId` in `seratoWatchFiles` and the selective-invalidation test
goes red, because a change could no longer be attributed to one track. Delete
the `CONTAINER_TAGS` skip and the smart-crate version record starts counting as
an unsupported rule. Delete `mergeSeratoRows` and the external-drive test goes
red.

## Remaining seams (not claimed done)

- Path differences from wp09: the task names `tools/fixtures/make-serato-lib`
  for the generator and `test-fixtures/synthetic/serato/` for synthetic
  fixtures. Both paths are outside this slice, so the generator lives in
  `packages/serato/src/test-fixtures.ts` and writes to caller-supplied temp
  directories. The orchestrator can move it without changing behaviour.
- The real `.scrate` rule layout is still unverified: the owner's
  `~/Music/_Serato_/SmartCrates` folder is empty and no sample exists on this
  machine, so rule evaluation is proven on generated fixtures. HW-SER-01
  collects a real smart crate; the parser is deliberately tolerant and labels
  anything it cannot read.
- `database V2` reads are per-call; a cached row set and the typed IPC queries
  belong to the library service slice (T-RBL-02 owns the Rekordbox half).
