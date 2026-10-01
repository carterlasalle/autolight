# T-RBL-02: Library service and ANLZ path resolution

Closes F-RBL-01, F-RBL-08. Spec 4.1, 5, 12, 141.

## What was wrong

`anlzPaths()` did string math on the constant file name `ANLZ0000` and knew
nothing about Rekordbox's share directory, so a real row
(`/PIONEER/USBANLZ/1ad/.../ANLZ0000.DAT`) resolved nowhere. There was no service,
no normalized row type and no missing-file statuses.

## What changed

- `src/anlz.ts` resolves the stored path against the share directory by
  stripping the leading separator and joining, which is the rule verified
  against the owner's library (share + `/PIONEER/USBANLZ/...` exists) and
  against pyrekordbox's `get_anlz_dir`. `.EXT` and `.2EX` siblings come from an
  extension swap on the row's own file name, not from a constant. A stored path
  that exists as a full absolute path (older exports) wins when the
  share-relative form is not there.
- Missing files are typed statuses, never exceptions: `audio-ok`,
  `audio-missing`, `anlz-ok`, `anlz-partial`, `anlz-missing`, with size and mtime
  facts per file.
- `src/db.ts` exposes `LibraryTrack` with the §12/§141 fields: rekordbox id,
  title, artist, album, genre, key, BPM, duration, rating, colour, comments,
  date added, file path, size, sample rate, bit rate, analysis paths, the
  resolved ANLZ set and `raw` with every other column.
- `src/service.ts` is the main-process LibraryService: `tracks()` with
  pagination and search plus a total, `track(id)`, `playlists()`,
  `playlistTracks(id)`, `history()`, `historyTracks(id)`, `watchTracks()` and
  `diagnostics()`. The IPC channels (`library/tracks`, `library/playlists`,
  `library/history`, `library/track`, `library/changed`) are wired in the
  desktop main process by the tasks that own `packages/ipc` and
  `apps/desktop/electron`.

## Proof

- `src/anlz.test.ts` resolves a real temp share directory (DAT/EXT/2EX present,
  sizes checked), a non-`ANLZ0000` base name, a partial set, a missing set, an
  empty path, an absolute stored path and an injected stat seam.
- `src/db.test.ts` asserts the fixture's statuses per track: `["audio-ok",
  "anlz-ok"]`, `["audio-ok","anlz-partial"]`, `["audio-ok","anlz-missing"]`,
  `["audio-missing","anlz-missing"]`, and that the ANLZ directory is the share
  path plus the row's relative directory.
- `src/service.test.ts` answers every typed query from the fixture, checks
  pagination (`limit`/`offset`), search by title, artist and path, playlist
  kinds (`playlist`, `folder`), history track counts, and the ANLZ summary in
  diagnostics (`{ ok: 1, partial: 1, missing: 2, audioMissing: 1 }`).
- Full package run: 9 files, 54 passed, 1 skipped.

## Delete test

Delete the temp share directory builder in `src/anlz.test.ts` (or the fixture's
ANLZ files) and the sibling/status assertions go red. Delete
`src/test-fixtures.ts` and `src/db.test.ts` plus `src/service.test.ts` go red.
The `P-95-library` screen probe belongs to T-UI-05 and is not claimed here.
