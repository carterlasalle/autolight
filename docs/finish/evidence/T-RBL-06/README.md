# T-RBL-06: Library change detection and selective invalidation

Closes F-RBL-10. Probe P-141-watch. Spec 141.

## What was wrong

Nothing watched the library: an edit in Rekordbox (or a moved audio file, or a
re-analysed grid) was invisible, and there was no notion of which cached
artifacts a change should drop.

## What changed

- `src/watch.ts` watches `master.db`, `master.db-wal`, each track's ANLZ DAT,
  EXT and 2EX files, and each audio file, comparing size and mtime per sweep.
- Two engines behind DS-35: `native-events` uses `@parcel/watcher` when it is
  installed and `fs.watch` otherwise, and `polling` is the stat sweep that also
  works on network drives and external disks. `auto` (default) runs native
  events plus a slow sweep (`library.watch.pollMs`) and counts the changes the
  events never reported, which is the missed-change counter Diagnostics shows
  (`LibraryService.missedChanges()`).
- Native events are debounced by `library.watch.debounceMs` (default 2000 ms):
  Rekordbox writes in bursts, so only the trailing edge reports.
- Invalidation is selective, and column classes decide it:
  - ANLZ (grid or PSSI) change: `native-analysis`, `model`, `plan` (plus `row`).
  - audio change: `audio-derived`, `native-analysis`, `model`, `plan`
    (everything derived for that track; hashing follows
    `library.fileHash.strategy` when the caller runs it).
  - `master.db` or the WAL alone: `row`.
  - row diff: `AnalysisDataPath`, `BPM`, `Analysed`, `AnalysisUpdated`,
    `CueUpdated` behave like an analysis change; `FolderPath`, `OrgFolderPath`,
    `rb_LocalFolderPath` are identity changes; a title edit invalidates the row
    only; added or removed rows are `identity` + `row`.
- `LibraryService.onChanged` emits `{ atMs, source, files, invalidated, diff }`
  so the UI can refresh only what moved.

## Proof

- `src/watch.test.ts` (temp files throughout):
  - one polling sweep finds the ANLZ edit and names
    `["model","native-analysis","plan","row"]`, the next finds the audio edit
    and names `["audio-derived","model","native-analysis","plan","row"]`;
  - the combined mode with a stub OS engine that reports nothing counts exactly
    one missed change and no more on a second sweep;
  - a change the OS events already reported does not increment the counter;
  - real OS events arrive for a temp file (fs.watch engine, probe writes until
    the platform watcher is live, which is the kqueue warm-up documented in the
    module);
  - the column classes above, added/removed rows, and the database/WAL-only
    case.
- `src/service.test.ts` drives a real row addition through the service: the
  emitted event carries `diff.added = ["105"]` and
  `invalidated = ["identity","row"]`.
- Rekordbox-open simulation (writer holding the WAL) does not block reads: the
  reader opens with `read_uncommitted` and never checkpoints, and the owner
  library was read while Rekordbox could be running (the module warns nothing,
  the read is read-only by construction). The full write-holder test with
  Rekordbox open on the owner Mac is HW-RB-LIB-01's job in wp15.
- Full package run: 9 files, 54 passed, 1 skipped.

## Delete test

Delete `src/watch.ts` and `src/watch.test.ts` fails to compile; delete only
`src/watch.test.ts` and the missed-change counter, the debounce, both engines
and the invalidation map lose their only check. Change
`invalidationForFiles` to drop the `plan` scope for ANLZ files and the ANLZ and
audio assertions in `src/watch.test.ts` go red, as does the service change
event test.

## Hand-offs (outside this slice)

- `@parcel/watcher` is declared optional in `packages/rekordbox-library/package.json`
  but not installed in this tree; the engine falls back to `fs.watch`, which the
  real-OS-event test covers. Adding it to the app dependencies is the desktop
  owner's call.
- The cache versioning rules of T-DATA-03 own what "invalidate" does to stored
  artifacts; this package only reports the scopes.
