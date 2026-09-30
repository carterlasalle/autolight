# WP09. Serato

Spec sections: 3.1, 121, 128, 136, 141. Findings closed: F-SER-01 to F-SER-06.

Start this package only after milestone M1 (the Rekordbox vertical slice)
runs. Serato is the secondary target, but "secondary" means second in order,
not reduced in scope: spec 121 lists 16 required items and all of them ship.

## 1. Required reading

| Source | What to take | License handling |
| --- | --- | --- |
| `chrisle/serato-connect` (spec 3.1: "Use directly") | The whole Remote implementation: Bonjour `_SeratoIOSRemote._tcp` advertisement, inbound connection from Serato, OSC 1.1, the custom TCP delimiter, MD5 challenge and response, deck metadata, playhead, play rate, effective BPM, autoloop and roll state, faders, crossfader, four decks, field coalescing on track change. Also its tests and fixtures | MIT; dependency, not a copy. Provenance note in `THIRD_PARTY_NOTICES` |
| Holzhaus `serato-tags` documentation (MIT) | GEOB tag formats: `Serato BeatGrid`, `Serato Markers2` (cues, loops, colours, flips, BPM lock), `Serato Autotags`, `Serato Overview`, `Serato Analysis`; base64 encoding in FLAC and MP4 | Read the docs; write our own parser with golden vectors from its examples |
| Serato library layout documentation (community) | `_Serato_/database V2`, `Subcrates/*.crate`, `SmartCrates/*.scrate` field tags | Documentation |

## 2. Facts

- Serato's network interface supplies identity, playhead, rate, effective
  BPM, play state, loop state, upfaders and crossfader; files supply grid,
  tempo regions, cues, loops, metadata, crates and library (spec 3.1).
- The existing `parseBeatGrid` reads every marker as (position, BPM). In the
  documented format, non-terminal markers are (f32 position, u32 beats until
  the next marker) and only the terminal marker is (f32 position, f32 BPM);
  the marker count is a 32-bit big-endian integer; a footer byte follows.
  The last tempo region runs to the end of the track, not four beats.

## 3. Tasks

### T-SER-01 serato-connect Remote provider

- Closes: F-SER-01; probe `P-3.1-serato-connect`.
- `yarn workspace @autolight/serato add serato-connect`. Wrap it in a
  `SeratoRemoteProvider` implementing `DJLiveProvider` (spec 6) in the main
  process `ProviderManager`. Do not reimplement anything serato-connect does
  (spec 3.1 "No duplicate implementation").
- Setup assistant: explains what to enable in Serato for the Remote
  connection, shows advertisement status, connection and authentication
  state, and per-deck update rate.
- Emulator for tests: drive serato-connect's own test fixtures or a scripted
  peer that speaks the Remote protocol over a real TCP socket (built from the
  serato-connect tests, so the emulator is not our guess of the protocol).
- DoD: provider passes the shared contract suite (`T-LIVE-01`) against the
  emulator for four decks; HW runbook `HW-SER-01` with Serato DJ on the owner's
  machine records a session for replay.

### T-SER-02 DeckState mapping, master inference, generation and coalescing

- Closes: F-SER-01, F-SER-04.
- Map every field serato-connect provides into `DeckStateV2`, including
  loops and rolls. Serato does not necessarily report a master deck: infer
  `master` from audible weight and play state with hysteresis
  (`serato.master.inferHoldMs`) and label it `derived`.
- Track changes increment `generation`; every field from the old track is
  cleared, not only loops (spec 120 item 14 applies to Serato too).
- Resolve the file path to a `TrackId` (`T-ID-01`); the file's GEOB data gives
  the grid when no analysis exists.
- DoD: tests for each field; a track change mid-loop leaks nothing; master
  inference test over a crossfade.

### T-SER-03 Serato file metadata: containers and GEOB tags

- Closes: F-SER-02, F-SER-03.
- Container readers: ID3v2 (MP3, AIFF, WAV chunks), MP4 atoms (M4A, AAC,
  ALAC), FLAC and Ogg Vorbis comments (base64 wrapped). Use a metadata
  library added with `yarn add` (for example `music-metadata`) for container
  access if it exposes raw GEOB and freeform atoms; otherwise parse the
  containers ourselves with golden tests.
- Tag parsers with golden vectors from the documentation's examples:
  - `Serato BeatGrid`: version header, u32 marker count, non-terminal markers
    (f32 position, u32 beats to next), terminal marker (f32 position, f32
    BPM), footer; build tempo regions where the last one runs to track end.
  - `Serato Markers2`: base64 payload of typed entries: CUE (index, position,
    colour, name), LOOP (index, start, end, locked, name), COLOR (track
    colour), BPMLOCK, FLIP (when present); unknown entry types kept raw.
  - `Serato Autotags` (BPM, auto gain, gain dB), `Serato Overview` (waveform
    overview retained as an array), `Serato Analysis` (version).
- Produce `nativeAnalysis.serato` in TrackModel v2 (`T-ANA-12`) with per-tag
  outcomes like `T-RBL-04`.
- DoD: golden tests per tag and per container; a variable-tempo fixture's
  grid maps beats to time within 1 ms of the documented expectation; a file
  with an unknown Markers2 entry keeps it raw and still parses the rest.

### T-SER-04 Serato library, crates, smart crates and watcher

- Closes: F-SER-06.
- Read `_Serato_/database V2` (tagged binary records: path, title, artist,
  BPM, key, and the rest retained raw), `Subcrates/*.crate` (ordered track
  paths), `SmartCrates/*.scrate` (rules; show them and evaluate the common
  rule types against library rows, labelling unsupported rules). Library root
  from `library.serato.root` (auto-detected; external drives have their own
  `_Serato_` folders, which are discovered and merged).
- Read-only by construction (`T-SEC-04`).
- Watcher through DS-35 like `T-RBL-06` with selective invalidation.
- DoD: fixture library generated by a script (`tools/fixtures/make-serato-lib`)
  parses completely; crate order preserved; an external-drive library merges;
  watcher test invalidates only the changed track.

### T-SER-05 Serato protocol fixtures and replay

- Closes: F-SER-05.
- `protocol-fixtures/serato/<serato-version>/<platform>/<action>/` with the
  same fixture format as spec 9.4 (raw capture of the Remote session, framed,
  plus owner-confirmed `expectedEvents`). A capture tool records the session
  through serato-connect's transport hooks (or a loopback TCP capture) for the
  spec 119 action list.
- Replay harness (`T-QA-03`) decodes raw captures through serato-connect's
  decoder at 1x, 2x, 10x and step.
- DoD: after `HW-SER-01`, every action has a non-empty fixture and replay passes;
  before it, the emulator-generated fixtures are stored under
  `test-fixtures/synthetic/serato/` and are not counted toward spec 121.

### T-SER-06 Serato definition of done

- Closes: spec 121 aggregation; probe `P-121-serato-dod`.
- A checklist test that maps each of the 16 items of spec 121 to the probes
  that prove it (discovery, auth, identity, filepath, playhead, BPM, play
  state, loops, rolls, faders, crossfader, native grid, GEOB cues and loops,
  two-deck mixing, seek handling, deterministic replay) and fails if any
  probe is missing or red.
- Status bar says `SERATO` when Serato is the source (spec 136); Rekordbox is
  recommended in Setup when both are installed.
- DoD: checklist green on SIM and on the owner's HW run.

## 4. Config keys added (added to `03` section 3.8)

`serato.master.inferHoldMs` (750, unmeasured).
