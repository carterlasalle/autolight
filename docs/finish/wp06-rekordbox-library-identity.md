# WP06. Rekordbox library, ANLZ extraction and durable track identity

Spec sections: 4, 4.1, 5, 5.1 to 5.5, 12, 73, 74, 110 (read-only), 138
(identity step), 141. Findings closed: F-RBL-01 to F-RBL-10, F-ID-01 to
F-ID-03, F-LIVE-07 (identity part), F-APP-03 (resolution part).

## 0. Why this package matters

Everything the show knows ahead of time comes from here: the DJ's beatgrid
(timing truth, spec 2.2), Rekordbox's phrase analysis (PSSI, immediate
structure without ML), cues, waveforms and vocal lanes. Today nothing opens
`master.db`, half of the ANLZ data is thrown away as booleans, the beat origin
is inconsistent, and a field named `sourceTimeMs` is multiplied by 1000. The
track a deck is playing cannot be resolved to a cached model, so the Live
screen shows fixture tracks.

## 1. Required reading before code

| Source | What to take | License handling |
| --- | --- | --- |
| `chrisle/rekordbox-connect` (spec 4.1) | Database location per OS, `options.json` discovery, SQLCipher key derivation, read-only open, WAL-aware reading, tracks, playlists, history, IDs, paths. Use as a dependency, do not reimplement what it already does | Check its license file before adding; record in `THIRD_PARTY_NOTICES` |
| `chrisle/alphatheta-connect` | Selected parsing logic named in spec 4.1 (ANLZ and database structures) | Same |
| `pyrekordbox` (already used in `analysis/src/autolight_analysis/native.py`) | ANLZ tag structures (PQTZ, PSSI, PCO2, PWAV, PWV2 to PWV7, PWVC), the database schema names, the key handling for the cross-check reader (DS-15) | MIT; provenance header |
| Deep Symmetry `crate-digger` (EPL-2.0) and its "Rekordbox export structure" analysis (documentation) | Tag layouts, PSSI XOR masking on EXT files, phrase mood and kind tables, waveform encodings | Read the documentation; do not copy code; cite in headers |
| `docs/SPEC.MD` sections 4, 5, 12, 74, 141 | The required fields | Normative |

Do not copy code from any GPL project. Nothing in this package needs one.

## 2. Facts to design around

- The installed Rekordbox is 7.2.10.0333 on the owner's Mac (2026-09-29). The
  library reader must work with Rekordbox 6 and 7 databases, detect the
  version it opened, and report it in Diagnostics.
- The database is SQLCipher encrypted. The key is derived locally the way
  rekordbox-connect and pyrekordbox do it. The key is a secret: never log it,
  never put it in a crash report, never show it in the UI.
- Rekordbox keeps a WAL. A reader that ignores the WAL misses recent edits.
  Open read-only, with the WAL readable, and never checkpoint (a checkpoint is
  a write).
- The app never writes Rekordbox data (spec 4.1, 110). This is enforced by
  construction in `T-SEC-04`, not by convention.
- `djmdContent.AnalysisDataPath` points at the ANLZ `.DAT`; `.EXT` and `.2EX`
  are siblings. The path is relative to Rekordbox's `share` directory on the
  machine. Verify the resolution rule against the owner's library in the HW
  runbook; do not assume it from memory.
- PSSI in `.EXT` files is XOR-masked on some versions; pyrekordbox handles the
  common case, and one EXT variant raises `ConstError` today (F-RBL-05).
  Extraction must be per tag with per-tag outcomes, so one bad tag never loses
  the rest.

## 3. Tasks

### T-RBL-01 Rekordbox library readers behind DS-15

- Closes: F-RBL-01.
- Add `rekordbox-connect` to `packages/rekordbox-library` with
  `yarn workspace @autolight/rekordbox-library add rekordbox-connect` (after
  checking its license and native dependencies; if it needs a SQLCipher
  native module, add it to the Electron rebuild list in `T-OPS-05`).
- Implement three reader modes selected by `library.rekordbox.reader`
  (DS-15), all visible in Settings with measurements:
  - `rekordbox-connect`: TypeScript reader in the main process library
    service.
  - `pyrekordbox`: the analysis worker (uv) exposes a `library-read` command
    that returns the same normalized rows; used when the TypeScript reader
    cannot open the database (for example a native module failure).
  - `auto` (combined, default): rekordbox-connect is authoritative;
    pyrekordbox runs a background cross-check of row counts, playlist
    membership and a sample of paths, and Diagnostics shows agreement.
- Config keys (added to `03` section 3.8): `library.rekordbox.dbPath`
  (default: auto-detected, override allowed), `library.rekordbox.optionsPath`
  (auto), `library.rekordbox.sharePath` (auto), `library.rekordbox.crossCheck`
  (true). Auto-detected values are shown with "detected" beside them.
- Fixture: `tools/fixtures/make-rekordbox-db` generates a small SQLCipher
  database with the real table names and columns (tracks, artists, albums,
  genres, keys, playlists with folders, playlist membership, history
  sessions and their songs, cues) from a JSON description, with a test key.
  It runs in CI through `uv run` or `yarn`, whichever library matches the
  reader under test, and is regenerated, never hand-edited.
- DoD: `P-4.1-readonly-library` passes for all three modes on the fixture
  DB (identical normalized output); a write attempt through any handle the
  service exposes throws (see `T-SEC-04`); the HW runbook step
  `HW-RB-LIB-01` (in `wp15`) on the owner's library records track, playlist and
  history counts from the app next to the counts Rekordbox shows, and they
  match. Evidence: test output, the runbook JSON, a screenshot of the Library
  screen with the owner's playlists.

### T-RBL-02 Library service and ANLZ path resolution

- Closes: F-RBL-01, F-RBL-08.
- A main-process `LibraryService` (see `04-target-architecture.md`) owns the
  reader. It exposes typed queries over IPC (`library/tracks`,
  `library/playlists`, `library/history`, `library/track`) with pagination
  and search, and emits `library/changed` events from `T-RBL-06`.
- For each track: resolve `AnalysisDataPath` to absolute `.DAT`, `.EXT` and
  `.2EX` paths, record which exist, their mtimes and sizes, and the audio file
  path, existence, size and mtime. Missing files are reported per track as
  typed statuses (`audio-missing`, `anlz-missing`, `anlz-partial`), not
  exceptions.
- Normalized row type `LibraryTrack` in contracts: `rekordboxId`, title,
  artist, album, genre, key, BPM, duration, rating, colour, comments, date
  added, file path, file size, sample rate, bit rate, analysis paths, and
  `raw` (every other column retained, spec 9.5 spirit).
- DoD: integration test on the fixture DB plus synthetic ANLZ files resolves
  every path; a track whose ANLZ is missing appears with `anlz-missing`; the
  typed IPC queries return the fixture rows from a running app (integration
  test through `packages/ipc`). The Library screen probe `P-95-library` is
  proven later in `T-UI-05`.

### T-RBL-03 Beat origin, units and beat to time mapping

- Closes: F-RBL-06, F-RBL-09; probes `P-2.2-grid-truth`, `P-73-beat-domain`,
  `P-74-mapping`.
- Decide and document in ADR-009 (`T-DOC-02`) one convention and apply it
  everywhere: musical position is `Beat`, fractional, 1-based (beat 1 is the
  first native grid beat); the grid keeps a 0-based `index`; every conversion
  goes through `packages/contracts/src/beat.ts`. PSSI phrase beats, cue beats,
  ML boundaries, AX or live beats and planner cue beats all use `Beat`.
- Branded types: `Beat`, `BeatIndex0`, `Seconds`, `Milliseconds`, `Ns`.
  `toNativeBeat` is rewritten: the input field that is in seconds is named
  `sourceTimeSeconds`, the output is `sourceTimeMs`, and the conversion is
  tested with a real PQTZ value from a synthetic ANLZ file.
- `beatToSourceSeconds` and `sourceSecondsToBeat` use binary search and
  piecewise-linear interpolation between grid anchors, handle variable tempo,
  and share one documented edge policy before the first and after the last
  anchor (extrapolate with the nearest segment's tempo).
- DoD: property test with 10,000 generated variable-tempo grids: round trip
  within 1e-6 s; monotonic in both directions; phrase start beat 1 maps to
  anchor `index 0` time exactly; benchmark: one million mappings on a
  2,000-beat grid under `contracts.mapping.benchMs` (config, measured on the
  reference Mac). ast-grep rule: no plan or cue type has a field ending in
  `Seconds` or `Ms` (spec 73). The single exception is the `EnvelopeTime`
  type (`{ unit: "beats"; value: number } | { unit: "ms"; value: number }`)
  used only for attack, release and impact durations, because spec 36 asks
  for a 90 ms impact; the renderer converts it through the current tempo
  (`T-REND-02`). The rule allows `EnvelopeTime` and nothing else.

### T-RBL-04 Full ANLZ extraction with per-tag outcomes

- Closes: F-RBL-02, F-RBL-03, F-RBL-04, F-RBL-05; probes `P-5-anlz-full`,
  `P-5.2-pssi-retained`, `P-5.3-cues`, `P-5.4-waveforms`, `P-5.5-vocal`.
- In `analysis/src/autolight_analysis/native.py`, extract each tag in its
  own guarded step that records an outcome `{tag, file, status: ok | absent |
  failed, error?}`:
  - PQTZ: every beat (index, beatInBar, time, tempo).
  - PSSI: mood, bank, end beat, and per phrase: index, start beat, kind,
    `k1` `k2` `k3` sub-kind flags, fill flag, fill beat, normalized label,
    raw label. Keep the raw entry bytes (hex) for diagnostics.
  - PCO2 (and PCOB where present): position, loop end, cue type, hot cue
    number, RGB colour, colour ID, comment, loop quantization numerator and
    denominator.
  - PWAV, PWV2, PWV3, PWV4, PWV5, PWV6, PWV7: arrays retained in the feature
    artifact (`.npz` or Arrow file in the analysis cache, `T-ANA-13`) with
    shape and encoding metadata; PWV6 and PWV7 decoded to three-band
    per-column arrays.
  - PWVC: the vocal information decoded into a per-beat or per-column vocal
    lane (document the encoding you find; if a field is not understood, keep
    it raw and say so in `docs/track-model.md`).
- When pyrekordbox raises on a variant (the `ConstError` EXT case), fall back
  to a minimal tag reader for that one tag (section headers and lengths are
  enough to skip or partially decode) and record `failed` with the error,
  keeping every other tag.
- Nothing is reduced to a boolean. TrackModel v2 (`T-ANA-12`) carries
  `nativeAnalysis.rekordbox` with all of it plus the outcomes list.
- DoD: `analysis/tests/test_native_full.py` on committed synthetic ANLZ files
  (made by `analysis/tests/fixtures/make_anlz.py` from `T-TRU-16`) asserts
  every field of every tag, including the EXT variant that triggers the
  fallback; a TS contract test parses the resulting TrackModel with all fields
  present; the owner-library test (opt-in, `AUTOLIGHT_OWNER_LIBRARY=1`)
  reports per-tag outcome counts over the whole library and the evidence
  README lists them.

### T-RBL-05 One definition for PSSI labels and section normalization

- Closes: F-RBL-07.
- Move the PSSI label tables (high, mid, low moods, including the `k1` `k2`
  `k3` rules for high-mood Intro, Up, Chorus, Outro) and the mapping to the
  normalized section vocabulary (spec 21) into one JSON file under
  `packages/contracts/data/pssi-labels.json` with a JSON Schema. TypeScript
  imports it; Python loads the same file through the config bridge path
  (`T-CFG-03`). Delete both hand-written copies.
- DoD: a parity test runs the same table cases in Vitest and pytest; jscpd
  reports no duplicate; changing one label in the JSON changes both outputs.

### T-RBL-06 Library change detection and selective invalidation

- Closes: F-RBL-10; probe `P-141-watch`.
- Watch `master.db` and `master.db-wal` (debounced by
  `library.watch.debounceMs`), each track's ANLZ files (mtime and size), and
  each audio file (mtime and size, then hash by `library.fileHash.strategy`
  when either changed). Implement both watcher engines behind DS-35
  (`library.watch.engine`): `native-events` (`@parcel/watcher`, added with
  `yarn workspace @autolight/desktop add @parcel/watcher`, OS event APIs) and
  `polling` (stat polling at `library.watch.pollMs`, which also works on
  network drives and external disks that do not deliver events). The combined
  `auto` mode uses native events and runs a slow polling sweep as a safety net
  that reports any change the events missed (a counter shown in Diagnostics).
- On change: diff the library rows (added, removed, changed columns), and
  invalidate only affected artifacts: a changed grid or PSSI invalidates the
  TrackModel's native part and the plan; a changed audio hash invalidates
  everything for that track; a changed title does not invalidate analysis.
  Invalidation goes through the cache versioning rules in `T-DATA-03`.
- DoD: integration test with temp files covers each change type and asserts
  exactly which artifacts were invalidated; a Rekordbox-open simulation
  (writer holding the WAL) does not block reads.

### T-RBL-07 Live deck to library to cached model resolution

- Closes: F-APP-03 (resolution part).
- The track resolver (main process) takes whatever a live provider reports
  (Rekordbox content ID, ANLZ path, file path, title and artist, deck and
  time) and resolves it to a `TrackId` through `T-ID-01`, then to the cached
  TrackModel and ShowPlan (`T-RUN-08` fast path). The resolver chain order is
  DS-22, each step reporting confidence and which step matched.
- The Diagnostics "Track Resolver" tab (`T-UI-10`) shows, per deck, the raw
  input, each resolver step's result, the chosen identity, and the time taken.
- DoD: integration test with the fixture library: each provider input shape
  (memory reader content ID, rkbx_link title plus artist, ProLink rekordbox
  ID, AX title text, Lighting IPC fields when decoded) resolves to the right
  track; an ambiguous title (two tracks with the same title) is not resolved
  by title alone and is reported as ambiguous.

### T-ID-01 Durable identity: alias graph, file hash and PCM fingerprint

- Closes: F-ID-01, F-LIVE-07; probe `P-12-rename-survives`.
- `TrackIdentity` (spec 12) with `sourceIds` (Rekordbox ID, Serato path),
  `canonicalPath`, `fileHash`, `pcmFingerprint`, title and artist. Persist an
  alias graph (`track_aliases` table, `T-DATA-02`): every native ID, path and
  hash ever seen for a TrackId.
- `fileHash`: SHA-256 of the full file by default (`library.fileHash.strategy`
  `full`; `sampled` hashes size plus fixed windows for speed on large
  libraries, and is labelled weaker).
- `pcmFingerprint` (DS-34, `identity.fingerprint.mode`):
  - `pcm-hash`: SHA-256 of the canonical decode (`T-ANA-03`) quantized to
    16-bit, which survives rename, move and tag edits exactly;
  - `acoustic`: a Chromaprint-style acoustic fingerprint for matching
    re-encodes (use `fpcalc` only if the owner accepts the LGPL binary in the
    installer; otherwise implement the documented algorithm in Python from its
    paper, not from GPL code);
  - `both` (combined, default): exact `pcm-hash` match first; `acoustic`
    similarity above `identity.fingerprint.acousticThreshold` proposes a
    "probably the same track" link that the owner confirms in the Library.
- Rename and move migration: a new path whose `fileHash` or `pcm-hash`
  matches an existing TrackId attaches to it; cached artifacts and edits are
  kept.
- Composite identity bug: `rowToIdentity` reads the path field the composite
  row actually carries (`canonicalPath` or `filePath`, normalized in one
  place), with a test using the composite provider's real output.
- DoD: `P-12-rename-survives` (rename, move to another folder, and retag a
  fixture file: same TrackId, same cached plan); a re-encoded copy is
  proposed, not auto-merged; alias graph persisted across restart.

### T-ID-02 Planner seed from the fingerprint

- Closes: F-ID-02; probe `P-27-seed-fingerprint`.
- The planner seed is derived from `pcmFingerprint` (falling back to
  `fileHash`, then to the native ID with a recorded "weak seed" flag).
  The plan records `seedSource`.
- DoD: two identities with the same fingerprint and different database IDs
  produce byte-identical plans; the docs claim matches the code.

### T-ID-03 Key the UI and cache by TrackId

- Closes: F-ID-03.
- Library rows, Inspector, corrections, preanalysis queue and plan cache are
  keyed by `TrackId`, never by title.
- DoD: E2E with two fixture tracks that share a title shows both, and
  opening each shows its own model.
