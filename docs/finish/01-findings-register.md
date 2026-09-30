# 01. Findings register

Every defect, gap, false claim and owner request collected from every review of
this repository, deduplicated, with its verification status and the task(s)
that close it. Nothing in this list may be left open at the end. The coverage
tool (`tools/check-coverage.mjs`) fails if any `F-*` ID here is not referenced by
a task in a work package file and on `STATUS.md`.

## Sources

| Code | Source |
| --- | --- |
| R1 | Direct audit of the repo by Claude, 2026-09-29 (read all source, ran build, typecheck, Vitest, pytest, probes) |
| R2 | Review "Your gut feeling is spot on" (scorecard with PASS/WORKING/CRITICAL GAP) |
| R3 | Review "forensic, file-by-file investigation" (receipts plus ground-truth protocol section) |
| R4 | Review "wez/govee2mqtt is an absolute goldmine" |
| R5 | Review "AutoLight Spec Compliance Audit" (five parallel deep audits) |
| R6 | Short review "the repo has the shape of the spec" (7,600 LOC observation) |
| R7 | `docs/research/prior-art-reuse.md` (reading of every linked repo and page) |
| R8 | Review "strong architectural prototype" (vertical path diagrams, identity mismatch, mixDown bypass) |
| R9 | Review "hollow-core defect" (percent estimates, double root, crossfader, CI portability) |
| R10 | Tooling review (Knip, dependency-cruiser, CodeQL, ast-grep, Stryker, mutmut, capability manifest, claim tests) |
| R11 | Review "Spec Conformance and Gap Report" (six audits, xvfb Electron launch) |
| R12 | Memo "Govee Device Control and Networking" |
| R13 | Review "AutoLight implementation audit" (125-finding register; its IDs such as `R13:GOV-04` are cited) |
| OWN | The owner's instructions in the request that produced this plan |
| PLAN | Found while writing this plan, by reading the code on 2026-09-30 |

## Verification codes

| Code | Meaning |
| --- | --- |
| V | Verified by reading or executing the code during R1 or PLAN |
| C | Claimed by a review, consistent with the code, not separately executed |
| U | External claim not verifiable from the repo; must be probed on hardware or against the upstream |
| X | Verified false. Listed in section 25 so the agent does not act on it |

---

## 1. App wiring, lifecycle, IPC (F-APP)

| ID | Finding | Sources | Ver | Closed by |
| --- | --- | --- | --- | --- |
| F-APP-01 | `electron/main.ts:12-26` declares `STARTUP_ORDER` and `SHUTDOWN_ORDER` arrays; `boot()` only creates a window, registers IPC, starts AX polling and a ProLink listener. No DB, show worker, Govee manager, DJ adapter manager, library watcher, analysis worker, venue restore, track resolution, plan compile or stream arming. `quitApp()` is never registered on `before-quit` | R1 R5 R8 R11 R13:APP-01 | V | T-ARC-03, T-ARC-05 |
| F-APP-02 | No show worker thread. The "show loop" is `useLiveCursor()` in `src/renderer/state/resolve-live.ts:130-164`, a 250 ms React `setInterval` (4 Hz). A frozen or reloaded renderer freezes the show. `process.hrtime.bigint()` is never used; diagnostics falsely claims "show worker has no process.hrtime" | R1-R13 | V | T-ARC-01, T-ARC-04, T-RUN-01 |
| F-APP-03 | Live decks are two hardcoded fixture files (`live-homecoming.*`, `live-deck2.*`) fetched from `./analysis/` because `vite.config.ts:27` sets `publicDir` to `test-fixtures`. No provider to identity to cache resolution. `show/live` returns `{ live: null }` | R1 R8 R9 R11 R13:APP-03 | V | T-TRU-02, T-RUN-08, T-RBL-07 |
| F-APP-04 | 15 of 23 IPC channels validate and echo (no-ops): `venue/list`, `venue/set-color`, `venue/device-action`, `show/state`, `show/style`, `show/energy`, `show/trigger-build`, `show/trigger-drop`, `follow/mode`, `master/blackout`, `master/full`, `master/freeze`, `master/intensity`, `master/resume`, `diagnostics/get` (`electron/ipc.ts:49-52`) | R1-R13 | V | T-TRU-03, T-ARC-02, T-RUN-07 |
| F-APP-05 | Preload exposes a generic `invoke(channel, payload)`; the eight "real" handlers bypass schema validation (they cast the payload); responses unvalidated; no sender check | R5 R11 R13:APP-05 | V | T-ARC-02, T-SEC-03 |
| F-APP-06 | IPC handlers are registered after `await win.loadFile/loadURL`, racing the renderer's first requests; renderer `invoke` swallows every error with `.catch(() => undefined)` | R13:APP-06 | V | T-ARC-02 |
| F-APP-07 | Preview uses `makeFixture("left",14)` and `makeFixture("right",14)` and `makeDeck({playing:true, channelFader:1, crossfader:1})` regardless of real devices and real deck state (`resolve-live.ts:36-60`) | R1 R8 R9 R13:APP-07 | V | T-TRU-02, T-ROOM-10, T-MIX-06 |
| F-APP-08 | Follow mode does not select a provider: the cursor always calls `follow/ax`; ProLink data is hardcoded `{beat:null, peerPresent:false}` in the renderer (`resolve-live.ts:148`); `follow/mode` is an echo; "SoundSwitch IPC (future)" copy | R8 R11 R13:APP-08 | V | T-LIVE-02, T-UI-09 |
| F-APP-09 | Cursor math: deck A preview adds `0.25*(bpm/60)*0.1` per 250 ms tick (10x too slow) while `estimatedBeat` omits the `0.1` (two inconsistent scales); deck B adds a fixed `0.02` per tick; beat clamped to grid length; uses the first grid beat's BPM; AX updates deck A only | R8 R9 R11 R13:APP-09 | V | T-RUN-02 |
| F-APP-10 | Duplicate AX polling: main polls at 1 Hz and the renderer at 4 Hz, each spawning `osascript` with an 8 s timeout, no in-flight coalescing, regardless of mode; macOS-only with Windows silently unavailable | R9 R13:APP-10 | V | T-LIVE-06 |
| F-APP-11 | The planner recompiles both tracks every 250 ms in React; a plan is replaced only if seed or style ID changed (parameter edits under the same ID are ignored); a style switch applies mid-playback with no phrase-boundary handover | R13:APP-11 | V | T-RUN-08, T-UI-14 |
| F-APP-12 | "Blinder on phrase" injects an `ALL` white hit at every multiple of 32 beats at intensity 1, bypassing restraint and real phrase boundaries; the cue can vanish mid-duration after recomputation | R13:APP-12 | V | T-UI-04, T-PLAN-05 |
| F-APP-13 | Comments and UI copy describe behaviour that does not exist ("BOTH decks actually loaded in Rekordbox right now", "real handler", "this is wired", show-service header, Setup copy) | R8 R9 R13:APP-13 | V | T-TRU-05, T-DOC-01 |
| F-APP-14 | React mounts twice: `main.tsx:7` and `shell.tsx:67-69` both call `createRoot(...).render(<Shell/>)` | R9 R13:UI-12 | V | T-UI-01 |
| F-APP-15 | `show-service.ts:9` says "Electron 33's Node lacks node:sqlite" but `apps/desktop/package.json` depends on Electron `^41.10.6`; the reasoning used to justify no DB in main is stale | PLAN | V | T-DATA-01 |
| F-APP-16 | `yarn dev` starts Vite only; there is no Electron dev launcher; README tells users to launch `dist/electron/main.cjs` by hand | R8 R13:DATA-07 | V | T-OPS-05, T-DOC-01 |
| F-APP-17 | Command palette "Emergency" items (Blackout, Freeze) only close the palette (`command-palette.tsx:31-32`) | PLAN | V | T-UI-03 |
| F-APP-18 | The style dropdown offers House, EDM, Hip-Hop, Chill mapped to 4 of the 7 built-in styles; Pop, Dark and Minimal are unreachable; names do not match spec 135 | PLAN | V | T-UI-14, T-PLAN-09 |
| F-APP-19 | The manual lane (`ControlGrid`: palette, flash on beat, alternating A/B, manual tier, sensitivity, swatches, White hold, target A/B/Both) changes only local UI state or calls echo channels | R5 R8 R13:UI-01 | V | T-UI-04, T-RUN-07 |
| F-APP-20 | Audio sync: level is computed, but `buildLive()` passes `reactiveEnergy:0, reactiveAmount:0`; the cursor overwrites `reactiveLevel` with `sensitivity*0.2`; the "this is wired" comment is false | R8 R9 R13:RUN-06 | V | T-AUD-01, T-AUD-03 |

## 2. Rekordbox library and ANLZ (F-RBL)

| ID | Finding | Sources | Ver | Closed by |
| --- | --- | --- | --- | --- |
| F-RBL-01 | No master.db reader in the app: no `options.json` discovery, no SQLCipher key derivation, no read-only open, no playlists, history or tracks; `rekordbox-connect` is not a dependency; `packages/rekordbox-library` is helpers plus `READ_ONLY = true` | R1 R3 R5 R8 R9 R11 R13:DJ-01 | V | T-RBL-01, T-RBL-02 |
| F-RBL-02 | PWAV and PWV2 to PWV7 and PWVC are reduced to presence booleans in `native.py:159-163`; no waveform or vocal data is retained | R1 R5 R13:ANA-11 | V | T-RBL-04 |
| F-RBL-03 | PCO2 extraction lacks cue type, RGB colour, colour ID and loop quantization | R5 R13:ANA-11 | V | T-RBL-04 |
| F-RBL-04 | PSSI mood, bank, end beat, fill, fill beat and raw entries are extracted in `native.py:73-91` and then dropped by `fusion.build_track_model`; the TS schema has no field for them | R1 R13:ANA-11 | V | T-RBL-04, T-ANA-12 |
| F-RBL-05 | EXT and 2EX parse failures are swallowed with bare `except Exception`; one unknown tag (the EXT variant that raises `ConstError`) loses all PSSI for the track with no per-tag diagnostics | R13:ANA-12 | V | T-RBL-04 |
| F-RBL-06 | `toNativeBeat` multiplies a field named `sourceTimeMs` by 1000 (`rekordbox-library/src/index.ts:29-32`) | R13:DJ-15 | V | T-RBL-03 |
| F-RBL-07 | PSSI label tables and section normalization are duplicated in TypeScript (`rekordbox-library`) and Python (`native.py`) | R11 | V | T-RBL-05 |
| F-RBL-08 | AnalysisDataPath resolution is pure string math; no mapping from master.db rows to ANLZ files exists in TypeScript | R13:DJ-01 | V | T-RBL-02 |
| F-RBL-09 | Beat origin mismatch: grid `index` is 0-based; PSSI phrase beats, AX mapping and ML boundaries are 1-based; the canonical mapping returns grid indices, so cues can land one beat late | R1 R13:DJ-15 | V | T-RBL-03 |
| F-RBL-10 | Library change detection (spec 141) is absent: no watcher on master.db and its WAL, ANLZ mtimes, audio mtime or hash | R5 R13:DJ-01 | V | T-RBL-06 |

## 3. Rekordbox live transport (F-LIVE)

| ID | Finding | Sources | Ver | Closed by |
| --- | --- | --- | --- | --- |
| F-LIVE-01 | No Lighting IPC provider, capture tooling or decoder. `protocol-fixtures/rekordbox/7.2.19/macos/handshake/` holds only a README; the three 7.2.10 fixtures are hand-written DeckState JSON with `"capture": ""`, all paused at 0.0 | R1-R13 | V | T-LIVE-09 |
| F-LIVE-02 | `replayFixture` ignores `capture` and returns `expectedEvents` with new timestamps (`rekordbox-live/src/index.ts:24-30`); replay can never fail | R1-R13 | V | T-LIVE-09, T-QA-03, T-TRU-15 |
| F-LIVE-03 | No rkbx_link-style memory transport and no consumer of rkbx_link's OSC output; ADR-001 never considered it although the owner marked it "REALLY IMPORTANT" | R1-R13, OWN | V | T-LIVE-03, T-LIVE-04, T-LIVE-11, T-DOC-02 |
| F-LIVE-04 | ProLink parser (`electron/follow.ts:59-83`): requires 60-byte packets (real beat packets are 0x60 = 96 bytes), reads offsets 32 and 46 (next-beat interval is at 0x24 and BPM at 0x5a), treats the next-beat interval in milliseconds as a beat counter, validates no header, packet type or device, accepts arbitrary 60-byte datagrams, swallows socket errors, never expires `peerPresent`, is observe-only with no Virtual CDJ keepalive, and its data never reaches the renderer | R1 R8 R11 R13:DJ-07 R13:DJ-08 | V | T-LIVE-05 |
| F-LIVE-05 | AX scrape (`follow.ts:22-45`): reads every static text of window 1, takes the first two `mm:ss` matches, cannot tell decks, elapsed from remaining, or paused from playing (any time found marks `playing: true`); main discards the elapsed value (`beat: null`); `axBeatToPlayhead` scans linearly and returns whole beats | R1 R11 R13:DJ-06 | V | T-LIVE-06 |
| F-LIVE-06 | The composite FLX4 provider is a pure mapper (`compositeToDeckState`, `compositeDeckState`); loop inactive and master null are hardcoded; nothing acquires the inputs; unused by the app | R1-R13 | V | T-LIVE-07, T-FLX-06, T-AUD-04 |
| F-LIVE-07 | Composite identity drops the audio path: the composite row carries `canonicalPath` but `rowToIdentity` reads `filePath` | R13:DJ-05 | V | T-LIVE-07, T-ID-01 |
| F-LIVE-08 | Version support is a string-prefix check (`isSupported`); no protocol registry, no qualification records; `unverifiedWarning` never reaches the UI | R13:DJ-17 | V | T-LIVE-13 |
| F-LIVE-09 | The local Rekordbox agent API on port 30001 was probed without the bearer token, returned 404s, and was declared "not a transport surface"; rkbx_os2l shows it resolves track IDs to paths with a session token | R11 R7 | V | T-LIVE-08 |
| F-LIVE-10 | OS2L (the protocol SoundSwitch accepts from VirtualDJ and that rkbx_os2l emits) is neither consumed nor considered | OWN R11 R7 | V | T-LIVE-10 |
| F-LIVE-11 | Ableton Link participation (spec 10) is absent | R5 | V | T-LIVE-12 |
| F-LIVE-12 | No path acquires master deck, loop state, pitch, SYNC, hot cue or loop roll state | R13:DJ-04 | V | T-LIVE-14, T-FLX-04 |
| F-LIVE-13 | Track switches can leak metadata: no generation token separates the old track's fields from the new one's (spec 120 item 14) | R13:DJ-13 | V | T-LIVE-01, T-LIVE-14 |
| F-LIVE-14 | No provider manager or failover; `PROVIDER_ORDER` is an unused constant | R13:APP-08 | V | T-LIVE-02 |
| F-LIVE-15 | SoundSwitch's Rekordbox integration requires a SoundSwitch Creative or Professional plan or trial; the product itself must run without SoundSwitch installed (spec 120 item 15) | R13 | C | T-LIVE-09, T-LIVE-15 |
| F-LIVE-16 | Version tension: installed Rekordbox is 7.2.10.0333; rkbx_link macOS community offsets cover 7.2.8, 7.2.17, 7.2.18 (Apple Silicon); the Lighting extension needs 7.2.19+ | PLAN R7 | V | T-LIVE-15 |

## 4. Serato (F-SER)

| ID | Finding | Sources | Ver | Closed by |
| --- | --- | --- | --- | --- |
| F-SER-01 | `serato-connect` is not a dependency; no Bonjour `_SeratoIOSRemote._tcp`, OSC, custom TCP delimiter, MD5 auth or subscriptions exist; spec 3.1 says use it directly and write no duplicate | R1-R13 | V | T-SER-01, T-SER-02 |
| F-SER-02 | `parseBeatGrid` reads every marker as (f32 position, f32 BPM); non-terminal markers are (f32 position, u32 beats-until-next); marker count read from one byte; footer ignored; `tempoRegionsToBeats` gives the last region 4 beats instead of running to track end | R1 R13:DJ-12 | V | T-SER-03 |
| F-SER-03 | No GEOB reader for real files (Markers2 cues, loops, colours, flips; Autotags; Overview) and no ID3, MP4 or FLAC container parsing | R5 R13:DJ-13 | V | T-SER-03 |
| F-SER-04 | `remoteToDeckState` sets `master: null`; track-change coalescing only resets loops; no generation token | R13:DJ-13 | V | T-SER-02 |
| F-SER-05 | No `protocol-fixtures/serato/` and no replay | R5 | V | T-SER-05 |
| F-SER-06 | No Serato library reading (database V2, crates, smart crates) and no watcher | R13:DJ-13 | V | T-SER-04 |

## 5. DDJ-FLX4 (F-FLX)

| ID | Finding | Sources | Ver | Closed by |
| --- | --- | --- | --- | --- |
| F-FLX-01 | No MIDI library in any package; no device open; `classifyCC` and `confirmAudible` have no callers | R1-R13 | V | T-FLX-01 |
| F-FLX-02 | MIDI channel ignored so deck 1 and deck 2 cannot be told apart; CC and note constants are unverified against the official map; crossfader and tempo constants are declared but not classified | R1 R13:DJ-09 | V | T-FLX-02 |
| F-FLX-03 | Missing map coverage: jog, pads and pad modes, hot cues, loops, beat length, EQ, colour/filter, browse/load, SHIFT, SYNC, master; 14-bit fader pairs | R5 R13:DJ-09 | V | T-FLX-02, T-FLX-03, T-FLX-04 |
| F-FLX-04 | Expressive hints from spec 11 (filter sweep, pad roll, fader rise, loop shrink, loop release) are not implemented and do not inform the director | PLAN | V | T-FLX-05 |
| F-FLX-05 | No FLX4 detection in setup and no controller status | R13:UI-10 | V | T-FLX-07, T-UI-09 |
| F-FLX-06 | Windows MIDI input through WinMM is single-client; if Rekordbox holds the FLX4 input, a second reader can fail to open it. No handling exists | PLAN | U | T-FLX-01 |

## 6. Track identity (F-ID)

| ID | Finding | Sources | Ver | Closed by |
| --- | --- | --- | --- | --- |
| F-ID-01 | No durable identity resolver: no alias graph, no file hash (`decode.file_hash` hashes the first MB and is unused), no PCM fingerprint, no rename or move migration | R5 R13:DJ-14 | V | T-ID-01 |
| F-ID-02 | The planner seed is `track.identity.id` (a database row ID), not the fingerprint required by spec 27; docs claim fingerprint | R5 | V | T-ID-02 |
| F-ID-03 | Library rows and the Inspector key tracks by title | R13:UI-06 R13:UI-08 | V | T-ID-03 |

## 7. Analysis worker (F-ANA)

| ID | Finding | Sources | Ver | Closed by |
| --- | --- | --- | --- | --- |
| F-ANA-01 | `worker.py:64` calls `events.append` before `events` is assigned at `:69`; the `NameError` is swallowed at `:66-67`; only the first ML boundary reaches drop detection; no section-transition events survive; coverage stays `full` | R1-R13 | V | T-ANA-11 |
| F-ANA-02 | Readable audio with no ANLZ short-circuits to a zero-duration empty ADAPTIVE model without decoding the audio (`worker.py:28-35`) | R13:ANA-01 | V | T-ANA-04 |
| F-ANA-03 | The ADAPTIVE artifact (empty grid) is rejected by the TS schema (`beats.min(1)`) | R8 R13:ANA-02 | V | T-ANA-04, T-ANA-12 |
| F-ANA-04 | `full` coverage is set whenever DSP ran, even with no ML; the ML dependency group is never installed by the client; there is no per-input readiness | R1-R13 | V | T-ANA-15, T-ANA-17 |
| F-ANA-05 | All-In-One's persistent session API (`AllInOneSession`) is unused and the comment says none exists; `device="cpu"` is hardcoded so CUDA is ignored | R5 R13:ANA-05 R13:ANA-07 | V | T-ANA-05 |
| F-ANA-06 | "Stems" are FFT band proxies (drum = low_mid + high; vocal = 300 to 3400 Hz band), not source-separated stems | R1-R13 | V | T-ANA-06 |
| F-ANA-07 | All-In-One tempo, beats, downbeats, labels, 100 Hz activations and embeddings are not retained | R11 R13:ANA-06 | V | T-ANA-05 |
| F-ANA-08 | Decode is not one canonical pipeline: `canonical_wav` writes integer PCM WAV, mono is decoded separately, the WAV cache key is the path string (stale after edits) | R13:ANA-08 | V | T-ANA-03 |
| F-ANA-09 | `resample_to_beats` stretches envelopes with `linspace` over the beat count and ignores beat timestamps (3 beats, 1.4 s off in a synthetic test) | R1-R13 | V | T-ANA-09 |
| F-ANA-10 | About 9 to 14 of the 22 spec 18 features are missing (loudness proxy, centroid, rolloff, flux as a frame series, onset strength and density, ZCR, kick and snare transients, stem RMS, dynamic range, energy derivative); five helpers are dead; no subbeat, bar or phrase aggregation; no frame-level artifact | R5 R11 R13:ANA-10 | V | T-ANA-09 |
| F-ANA-11 | Only build-start, drop, fake-drop, breakdown and silence are ever emitted; the contract enum lacks several spec 22 events | R1-R13 | V | T-ANA-10, T-ANA-12 |
| F-ANA-12 | Fake drops: silence variant only; 4-beat step search; downbeat-only candidates; fields named `beat`/`endBeat` rather than `fakeImpactBeat`/`actualImpactBeat` | R5 R11 R13:ANA-15 | V | T-ANA-10 |
| F-ANA-13 | Drop detection ignores `novelty`; `on_downbeat=True` is hardcoded; candidates are every 4th array index rather than real `beatInBar`; an 8-beat "restraint" inside the detector deletes legitimate events | R1 R13:ANA-15 | V | T-ANA-10 |
| F-ANA-14 | Build detection uses energy and drum slope only (no centroid, onset density, bass movement, boundary confidence or harmonic tension slopes) | R13:ANA-15 | V | T-ANA-10, T-ANA-18 |
| F-ANA-15 | Beat This CLI invoked as `beat_this audio out` (the output flag is `-o`); every first column is read as a downbeat without beat-in-bar | R13:ANA-16 | V | T-ANA-07 |
| F-ANA-16 | GRID_WARNING compares only the first timestamp and is encoded as a fake `section-transition` at beat 1, appended twice | R5 R11 R13:ANA-17 | V | T-ANA-08 |
| F-ANA-17 | Evidence is computed and stripped; the TS schema has no evidence field; a test asserts its absence | R5 R11 R13:ANA-13 | V | T-ANA-11, T-ANA-12 |
| F-ANA-18 | Duration comes from the last beat (drops the tail); analyzer version hardcoded `0.1.0`; artifact filename is a hash of the track ID only; non-atomic overwrite; default output `/tmp/autolight-analysis`; no source fingerprint | R11 R13:ANA-18 | V | T-ANA-13 |
| F-ANA-19 | `silence_probability(0.005)` returns 1.5; `beat_aggregate` divides partial groups by the full group size | R13:ANA-19 | V | T-ANA-14 |
| F-ANA-20 | `AnalysisClient`: requeue drops `audioPath` and `nativeMetadataPath`; queue never drained; no restart; duplicate track IDs overwrite pending resolvers; calls before `start()` hang; no timeouts, cancel, progress or concurrency; spawn errors unhandled; relative project path; never instantiated | R1-R13 | V | T-ANA-02 |
| F-ANA-21 | `worker.main()` parses JSON outside the error guard (a malformed line kills the worker); third-party stdout can corrupt the protocol | R13:ANA-21 | V | T-ANA-01 |
| F-ANA-22 | No fresh-machine preparation: no bundled Python/uv/FFmpeg/models, weights download on first use, no pre-warm, no offline mode | R5 R13:ANA-22 | V | T-ANA-05, T-OPS-05 |
| F-ANA-23 | A nonexistent audio file returns `complete` with an empty model instead of a typed failure | R11 | V | T-ANA-04, T-ANA-15 |
| F-ANA-24 | TrackModel lacks metadata, nativeAnalysis, phrases, frameFeatures, beatFeatures; Zod strips unknown fields | R1-R13 | V | T-ANA-12 |
| F-ANA-25 | Three pytest tests hardcode `/Users/rocket/...` paths and fail on any other machine; CI's pytest step is red; `yarn verify:phase1` exits 1 | R1-R13 | V | T-TRU-16 |
| F-ANA-26 | All five committed real-track TrackModels are `structured` with zero events; the only "proven" show has three cue types and no drop programming | R1 | V | T-ANA-16, T-QA-09 |
| F-ANA-27 | All-In-One labels never form sections when PSSI is absent; confidences are constants (0.8, 0.7, 0.9) rather than evidence-derived | R13:ANA-13 | V | T-ANA-11 |
| F-ANA-28 | Harmonic tension proxy (spec 23) and key are absent | PLAN | V | T-ANA-18 |
| F-ANA-29 | ML weight download location, licensing and offline behaviour are unmanaged | R5 | V | T-ANA-05, T-OPS-05 |

## 8. Show planner (F-PLAN)

| ID | Finding | Sources | Ver | Closed by |
| --- | --- | --- | --- | --- |
| F-PLAN-01 | `planShow` computes `trackIdentity()` and discards it (`void identity`, `show-planner/src/index.ts:84-85`); the renderer invents hue from `(startBeat*137+210)%360` (15 hues for 15 sections on a real track) | R1-R13 | V | T-PLAN-01, T-PLAN-02, T-REND-03 |
| F-PLAN-02 | ShowPlan lacks `globalDesign`, `sections`, `recurrence` (MotifMap) and `constraints`; the planner takes no VenueModel or capability class | R5 R13:PLAN-02 | V | T-PLAN-01 |
| F-PLAN-03 | About 7 of the 27 required primitives exist, as free strings; no per-primitive parameters (colour, attack, release, direction, origin) | R1-R13 | V | T-PLAN-04, T-REND-02 |
| F-PLAN-04 | Hierarchy is a section look plus a fixed 8-beat chase-flip; phrases, bars, beats and sub-beats are not planned | R1-R13 | V | T-PLAN-03 |
| F-PLAN-05 | Recurrence is occurrence parity (`motifVariant` ignores its `kind`); no similarity, no motif memory | R1-R13 | V | T-PLAN-08 |
| F-PLAN-06 | Style fields `darknessPreference`, `strobeFrequency`, `reactiveAmount` are unused; `spatialDensity`, `colorSaturation`, `paletteChangeRate`, `movementDensity`, `impactAggression`, `symmetry` are missing | R1-R13 | V | T-PLAN-09 |
| F-PLAN-07 | The restraint engine is one 8-beat white-hit cooldown with a "ponytail" comment; 10 of 11 required state fields are missing | R1-R13 | V | T-PLAN-05 |
| F-PLAN-08 | Contrast is a scalar per section kind; drops get no staged build, no pre-drop darkness, no 90 ms impact, no quantized burst, no reveal | R1-R13 | V | T-PLAN-06 |
| F-PLAN-09 | Event confidence and strength are unused; fills, vocals, silence, final hits and outro releases are ignored | R13:PLAN-08 | V | T-PLAN-07 |
| F-PLAN-10 | `validatePlan` is narrow and never runs in production; `evaluatePlan` computes 5 of the 10 spec 115 diagnostics, crudely | R1-R13 | V | T-PLAN-10 |
| F-PLAN-11 | `regenerateSection` uses array indices that shift after regeneration; no cue IDs, lock regions or edit persistence | R13:PLAN-10 | V | T-PLAN-11 |
| F-PLAN-12 | The planner golden writes itself if missing (`golden.test.ts:19-26`); the reference track is synthetic and tiny | R11 R13:QA-05 | V | T-TRU-15, T-PLAN-15 |
| F-PLAN-13 | `blendRgb` (linear light) is only used by a unit test; no OKLab or OKLCH exists anywhere | R1-R13 | V | T-PLAN-02, T-MIX-02 |
| F-PLAN-14 | No candidate-scoring hook (spec 113) | PLAN | V | T-PLAN-12 |
| F-PLAN-15 | No strobe cue is ever generated, so strobe budgets and invariants are untestable | R8 R11 | V | T-PLAN-04, T-PLAN-05 |
| F-PLAN-16 | Cues have no colour field and targets are free strings with no `SpatialSelector` type | R1 | V | T-PLAN-01 |
| F-PLAN-17 | `SECTION_ENERGY` and every other planner number are hardcoded | PLAN OWN | V | T-CFG-04, T-PLAN-09 |
| F-PLAN-18 | Determinism inputs omit the venue capability class (spec 27) | PLAN | V | T-PLAN-01 |

## 9. Renderer (F-REND)

| ID | Finding | Sources | Ver | Closed by |
| --- | --- | --- | --- | --- |
| F-REND-01 | Cells composite with `Math.max`, so higher-priority darkness cannot override lighter layers; partial blackouts and dips are no-ops (28 of 28 cells stayed lit) | R1-R13 | V | T-REND-01 |
| F-REND-02 | White hit and impact are rendered as a chase phase; any `ALL` white or impact whites out every lit cell; no attack or release envelopes | R13:RENDER-02 | V | T-REND-02 |
| F-REND-03 | Hue comes from the start beats of the lowest-priority active cues, in HSV; the secondary hue drifts as chase cues advance | R1-R13 | V | T-REND-03 |
| F-REND-04 | `renderWithLatency` renders each fixture alone, changing global order, parity and phase; zero latency gives a different frame than `renderFrame`; latency converts through one fixed BPM | R9 R13:RENDER-04 | V | T-REND-04 |
| F-REND-05 | LEFT, RIGHT and CENTER are population thirds of a sorted cell list, not physical regions | R13:RENDER-05 | V | T-ROOM-06, T-REND-05 |
| F-REND-06 | Calibration gamma, brightness ceiling, orientation and transforms are ignored; gamma is a fixed 2.2 | R1-R13 | V | T-REND-03 |
| F-REND-07 | Frames allocate `cells.length*3` bytes but write at `cell.index*3`; sparse indices misaddress; the UI reads frames by array position | R13:RENDER-07 | V | T-REND-05 |
| F-REND-08 | The 8-layer stack of spec 33 does not exist | R1-R13 | V | T-REND-01 |
| F-REND-09 | `renderer/src/index.ts:1` imports `createHash` from `node:crypto` and never uses it | PLAN | V | T-TRU-14 |
| F-REND-10 | Per-cell `fixtures.find` and string-keyed maps on the hot path (quadratic, allocation-heavy, AGENTS.md section 8) | PLAN | V | T-REND-05 |
| F-REND-11 | Intensity is applied to a pure hue via `linearScale(255, level*shape)` with a hardcoded 0.75 to 1.0 left-to-right shape; not linear-light scaling of arbitrary colours | PLAN | V | T-REND-03 |

## 10. Two-deck mixer (F-MIX)

| ID | Finding | Sources | Ver | Closed by |
| --- | --- | --- | --- | --- |
| F-MIX-01 | `audibleWeight = channelFader * crossfader` for every deck: at crossfader 0 both decks are silent, at 1 both are full; no assignment or curve | R1-R13 | V | T-MIX-01 |
| F-MIX-02 | Base weights are normalized, so a lone quiet deck produces a full look | R13:MIX-02 | V | T-MIX-02 |
| F-MIX-03 | `translateBlackout` returns unchanged when `target === "ALL"` (the case spec 66 exists for) and emits an unresolvable `SIDE` target | R1-R13 | V | T-MIX-04 |
| F-MIX-04 | `liveViewModel` renders `mixA.cues` and `mixB.cues`, bypassing `mixDown`; a non-owner's exclusive white hit changes the pixels | R8 R13:MIX-04 | V | T-MIX-06 |
| F-MIX-05 | Deck colours blend as gamma-encoded integers; upcoming cues from both decks are filtered with one deck's beat | R11 R13:MIX-05 | V | T-MIX-02, T-MIX-06 |
| F-MIX-06 | Introduction stages use a `priority <= 11` heuristic instead of layer semantics | PLAN | V | T-MIX-05, T-PLAN-13 |
| F-MIX-07 | Impact ownership uses weight times strength only; master, confidence and structural significance are ignored | PLAN | V | T-MIX-03 |
| F-MIX-08 | Master deck is ignored everywhere (`master: null`) | R13:DJ-13 | V | T-MIX-01, T-LIVE-14 |

## 11. Show runtime (F-RUN)

| ID | Finding | Sources | Ver | Closed by |
| --- | --- | --- | --- | --- |
| F-RUN-01 | `trackDeck` sets `predicted = prevBeat + 0`, calls `isSeek` with beats as seconds, has no PLL or smooth correction; no production caller | R1-R13 | V | T-RUN-02, T-RUN-03 |
| F-RUN-02 | Loops are not integrated (`DeckState.loop` never consumed; pass variation unused); tiny loop and roll degradation (spec 60) absent | R1-R13 | V | T-RUN-04 |
| F-RUN-03 | Scratch, reverse and paused seeks are conflated: any negative rate holds, and a paused hot cue jump holds instead of reconstructing | R13:RUN-03 | V | T-RUN-05 |
| F-RUN-04 | `quantizeResume` rounds `immediate` up to the next integer; bar and phrase assume multiples of 4 and 16 rather than native downbeats and phrases | R13:RUN-04 | V | T-RUN-07 |
| F-RUN-05 | `clockHealth` reports `live` only at exactly 0 ms; degradation is never applied to output; no adaptive switch | R1 R13:RUN-05 | V | T-RUN-06 |
| F-RUN-06 | The adaptive director picks one of four strings by `seed % n`; no phrase-length looks; unused | R5 R13:RUN-05 | V | T-RUN-09 |
| F-RUN-07 | The manual override state machine (spec 134) does not exist | R1-R13 | V | T-RUN-07 |
| F-RUN-08 | No "live track without prepared show" handling or clean upgrade at a phrase boundary (spec 140) | R13:APP-11 | V | T-RUN-08 |
| F-RUN-09 | `loadFastPath` returns an artifact path as `trackJson`; unused | R13:DATA-03 | V | T-RUN-08, T-DATA-04 |
| F-RUN-10 | Fault policies (spec 105 to 107) are pure functions with no runtime; no per-device FPS backoff in a real loop | R5 | V | T-RUN-06, T-GOV-06 |

## 12. Live audio and adaptive (F-AUD)

| ID | Finding | Sources | Ver | Closed by |
| --- | --- | --- | --- | --- |
| F-AUD-01 | Reactive audio is a time-domain peak; no FFT, mel banks, onset detection, spectral difference or AGC in capture; `agcStep` is unused | R1-R13 | V | T-AUD-02 |
| F-AUD-02 | `applyOverlay` adds gain to zero channels (relights darkness) and per channel (shifts hue) | R13:RUN-07 | V | T-AUD-03 |
| F-AUD-03 | `getUserMedia({audio:true})` ignores the selected device; repeated Start leaks AudioContexts and RAF loops; stale sensitivity closure; enumeration mislabeled as permission granted | R9 R13:UI-11 | V | T-AUD-01 |
| F-AUD-04 | `MAX_OVERLAY_GAIN = 0.2` is hardcoded with a "ponytail" comment; spec 68 says the amount is style-dependent | R5 PLAN | V | T-AUD-03, T-CFG-04 |
| F-AUD-05 | Audio capture lives in the React renderer and dies with a UI reload (spec 108) | PLAN | V | T-AUD-01 |

## 13. Govee LAN (F-GOV)

| ID | Finding | Sources | Ver | Closed by |
| --- | --- | --- | --- | --- |
| F-GOV-01 | `vendor/govee-toolkit/` is a 28-line `PIN.md`; no dependency on `govee-toolkit`; `ToolkitStreamFactory` has only a test double | R1-R13 | V | T-GOV-01 |
| F-GOV-02 | `encodeFrame` uses a 1-byte length that counts opcode and checksum and an XOR that skips `0xBB`; no `{"cmd":"razer","data":{"pt":base64}}` envelope; no gradient or segment-count bytes; zero tests; `vendor/README.md` claims "implemented and tested" | R1 R7 R11 R13:GOV-02 | V | T-GOV-02 |
| F-GOV-03 | No razer lifecycle (arm B1, settle, stream B0/B4, status B2, disarm); `pushFrame` has no callers | R1-R13 | V | T-GOV-08 |
| F-GOV-04 | `frameToLan` collapses a frame to its middle cell and sends whole-device `colorwc`; comments assert "H6076 is single-zone over LAN (community-confirmed)"; spec 153 violation | R1-R13 | V | T-GOV-10 |
| F-GOV-05 | Black frames send `turn(false)`; coloured frames send `turn(true)`, `brightness`, `colorwc` every frame (three back-to-back commands, the third of which the toolkit documents as dropped); spec 46, 47, 50 violations | R1-R13 | V | T-GOV-09 |
| F-GOV-06 | `sendToDevice` spawns `node -e` per datagram and never closes the socket (5 of 5 children alive after 4 s); `node` is not on PATH in a packaged app | R1-R13 | V | T-GOV-04 |
| F-GOV-07 | Discovery: per-interface broadcast addresses are never supplied; broadcast enabled after sends; multicast membership on the default interface only; remembered IPs in memory only; no backoff or background rescan; each scan binds a new socket on 4002; no port-conflict message; replies without `ip` (govee2mqtt issue 437) are rejected | R1 R4 R8 R13:GOV-08 | V | T-GOV-05 |
| F-GOV-08 | `devStatus` is sent but replies are never consumed; `parseStatusReply` is unused; Diagnostics claims "devStatus read-back verified per command" | R1 R13:GOV-09 | V | T-GOV-07 |
| F-GOV-09 | Identity mismatch: the service keys devices by Govee device ID while UI tiles use the IP as ID, so IDENTIFY and TEST CHASE return `{ok:false}` | R8 R13:GOV-10 | V | T-GOV-06 |
| F-GOV-10 | IDENTIFY sends only `turn on` (comment: white flash then restore); TEST CHASE sends one `brightness 100` (comment: 3-step ramp); RECALIBRATE is an echo | R1-R13 | V | T-GOV-12 |
| F-GOV-11 | Venue tiles are filled with 14 segments, 30 fps, 25 ms, online, firmware unknown immediately after a scan | R1-R13 | V | T-GOV-11, T-UI-08 |
| F-GOV-12 | No qualification runner (spec 52 lists 16 steps; code lists 12 names); no REQUALIFICATION REQUIRED persistence | R1-R13 | V | T-GOV-11 |
| F-GOV-13 | `DeviceManager`, `FrameCoalescer`, `LatestStream` are unused in production; no reconnect re-arm or current-frame resend; no real per-device FPS backoff | R1-R13 | V | T-GOV-06, T-GOV-08 |
| F-GOV-14 | `LatestStream.flush()` still sends after `close()`; pending `Uint8Array` buffers are shared and mutable | R13:GOV-14 | V | T-GOV-08 |
| F-GOV-15 | No H6076 or H1A45 device profiles and no per-unit calibration persistence | R1-R13 | V | T-GOV-13 |
| F-GOV-16 | Global brightness is sent per frame; there is no slow master-intensity path | R13:GOV-06 | V | T-GOV-09, T-RUN-07 |
| F-GOV-17 | Cloud limits must be configuration; Govee documents 10 requests per minute per device and 10,000 per day per account (toolkit `docs/protocol/cloud.md`, unconfirmed live); cloud is never a frame path | R11 R7 | C | T-CLD-01 |
| F-GOV-18 | `LanTransport = "lan" \| "ble" \| "cloud"` is misnamed and has no Matter | R13:GOV-15 | V | T-FOV-01 |
| F-GOV-19 | Comments credit "Lightwave order" for a BLE last-resort fallback; Lightwave has no BLE control | R7 | V | T-TRU-14 |
| F-GOV-20 | Spec 111 network hygiene absent: interface binding choice, no-WAN guarantee, network trust status in diagnostics | R13:DATA-06 | V | T-GOV-16, T-SEC-02 |
| F-GOV-21 | Unknown firmware model (spec 147) absent: background checks, no spamming of a failing raw stream, verified fallback only | PLAN | V | T-GOV-17 |
| F-GOV-22 | No frame-rate cap by zone count; toolkit measured ceilings (40 Hz at 20 zones, 25 Hz at 60, 20 Hz at 120 on H61A0) and a 10 Hz fallback are not encoded | R7 | V | T-GOV-08, T-GOV-11 |
| F-GOV-23 | Toolkit traps not encoded: arm settle about 50 ms; `turn` or white `colorwc` while armed ends the channel; three back-to-back commands drop the third; a unit may not answer status while armed | R7 | V | T-GOV-08, T-GOV-14 |
| F-GOV-24 | Community report that some H6076 hardware revisions lost LAN support | R12 | U | T-GOV-10, T-GOV-11 |
| F-GOV-25 | UDP 4002 is exclusive; Govee Desktop, homebridge-govee, SignalRGB or Govee LAN Control can hold it; no detection or message | R7 | V | T-GOV-05 |
| F-GOV-26 | The SignalRGB network checklist (LAN toggle, same subnet, firewall, AP or client isolation) is not surfaced in setup or diagnostics | R7 | V | T-GOV-16, T-UI-10 |
| F-GOV-27 | `ptReal` over LAN (base64 BLE-format packets, govee2mqtt) is unused; useful for scenes as idle or ending looks | R7 | V | T-GOV-18 |
| F-GOV-28 | Segment resolution selection (spec 53: logical, grouped, native) is not implemented; `selectResolution` is unused | PLAN | V | T-GOV-15 |
| F-GOV-29 | Per-device metrics (frames requested, sent, superseded, FPS, status RTT, last response, health) are not collected | R1-R13 | V | T-GOV-19 |
| F-GOV-30 | H1A45 is RGBWWIC; white LEDs must not be used for show-time white hits (spec 48) unless qualified to not disarm the stream; policy undefined | PLAN | U | T-GOV-09 |

## 14. BLE (F-BLE)

| ID | Finding | Sources | Ver | Closed by |
| --- | --- | --- | --- | --- |
| F-BLE-01 | No BLE transport; `"ble"` exists only as a type string | R1-R13 OWN | V | T-BLE-01 to T-BLE-10 |
| F-BLE-02 | Required protocol knowledge is not encoded: GATT service and characteristics, 20-byte `0x33` frames with XOR, one connection at a time, paced writes (100 Hz budget measured on H61A0), masked zone colour `33 05 15 01`, per-zone brightness `33 05 15 03`, reads `aa 0f` (segment count) and `aa 40` (IC count), host colour channel `a5 02 83` with sum checksum, encoded-link flag `0x40` with handshake, address to Wi-Fi MAC binding, advertisement name families | R7 PLAN | V | T-BLE-02 to T-BLE-07 |
| F-BLE-03 | OS permissions and prompts (macOS `NSBluetoothAlwaysUsageDescription`, Windows capability, Linux BlueZ) are not handled | PLAN | V | T-BLE-08 |
| F-BLE-04 | Discovery-only versus control must be distinct; LAN and BLE identities must not auto-merge (Lightwave lesson) | R7 | V | T-BLE-02 |
| F-BLE-05 | BLE is the owner's answer for campus or venue Wi-Fi with client isolation | OWN R2 R3 | V | T-FOV-02 |
| F-BLE-06 | Newer firmware requires an encrypted BLE session (toolkit `E7` handshake; govee-homeassistant AES-GCM v2 read from characteristic `...2b12`) | R7 PLAN | V | T-BLE-07 |

## 15. Matter and cloud (F-MAT, F-CLD)

| ID | Finding | Sources | Ver | Closed by |
| --- | --- | --- | --- | --- |
| F-MAT-01 | No Matter controller (matter.js); no commissioning, multi-admin pairing, OnOff, LevelControl or ColorControl; Matter is basic control only and never a segment stream | OWN R12 R13 | V | T-MAT-01 to T-MAT-04 |
| F-CLD-01 | No cloud client for capability discovery, metadata and setup; API key storage in `safeStorage` absent; must never carry frames | R13:DATA-06 PLAN | V | T-CLD-01, T-CLD-02, T-SEC-01 |

## 16. Venue model (F-VEN)

| ID | Finding | Sources | Ver | Closed by |
| --- | --- | --- | --- | --- |
| F-VEN-01 | `Fixture` lacks `topology`, `transform` and `capabilities` (spec 38) | R5 R13:GOV-11 | V | T-ROOM-02 |
| F-VEN-02 | No 2D venue editor (drag, rotate, reverse, resize, tags, groups) | R1-R13 | V | T-ROOM-03 |
| F-VEN-03 | Default groups are not derived from positions; only explicit `fixture.groups` resolve | PLAN | V | T-ROOM-06 |
| F-VEN-04 | No persisted venues and no switching between venues | R13:DATA-01 | V | T-ROOM-11 |
| F-VEN-05 | Orientation and cell order are never applied in rendering; `applyOrientation` is unused | R13:RENDER-06 | V | T-ROOM-04, T-REND-03 |

## 17. Room perimeter mapping, owner request (F-ROOM)

| ID | Finding | Sources | Ver | Closed by |
| --- | --- | --- | --- | --- |
| F-ROOM-01 | The owner's rig has segmented strips on the ceiling tracing the room outline (a square room). The app has no way to draw the room shape, mark the DJ position, set the "middle", or map where the strip's controller sits and where its runs go and meet | OWN | V | T-ROOM-01, T-ROOM-03, T-ROOM-04 |
| F-ROOM-02 | Effects must be expressible over that geometry: alternating half-room strobes, pulses originating from a point, a light that continuously circles the room, and more | OWN | V | T-ROOM-05, T-ROOM-06, T-ROOM-07 |
| F-ROOM-03 | The controller point and the meeting point of two runs are generally not where the DJ stands, so effects must be anchored to user-defined points, not the strip's index 0 | OWN | V | T-ROOM-04, T-ROOM-05 |
| F-ROOM-04 | The preview must show the real room with every real cell | OWN R13:UI-04 | V | T-ROOM-10 |

## 18. UI (F-UI)

| ID | Finding | Sources | Ver | Closed by |
| --- | --- | --- | --- | --- |
| F-UI-01 | Many visible controls only change local state (see F-APP-19) | R8 R13:UI-01 | V | T-UI-04 |
| F-UI-02 | Master intensity is a hardcoded "80%" badge; shortcut A sends resume without the required `at` and is rejected; Z always sends `frozen: true` (no toggle); the comment promises Space and 1 to 9 which do not exist | R11 R13:UI-02 | V | T-UI-03 |
| F-UI-03 | No dual waveform; deck cards show about 3 of 17 spec 90 fields; `countdown` is always `undefined` so "DROP IN 8" can never render | R1-R13 | V | T-UI-02 |
| F-UI-04 | The venue preview is a flex row of swatches that loses y, z, fixture and segment identity | R13:UI-04 | V | T-ROOM-10, T-UI-02 |
| F-UI-05 | Upcoming cues are rebuilt with a fake duration of 4, intensity 0.8, priority 10, and use one deck's beat for both decks | R13:UI-05 | V | T-UI-02, T-MIX-06 |
| F-UI-06 | Library shows at most the two fixture tracks with title IDs, READY hardcoded, one BPM repeated, blank artist | R1-R13 | V | T-UI-05 |
| F-UI-07 | Inspector prints the first 24 values of three text lanes from fixture files; no graphical lanes; no audition | R1-R13 | V | T-UI-06 |
| F-UI-08 | Inspector can show deck A when deck B is selected and refetches on every live tick | R13:UI-08 | V | T-UI-06 |
| F-UI-09 | No track corrections UI | R1-R13 | V | T-UI-07 |
| F-UI-10 | No venue canvas or calibration wizard; Setup is a checklist that marks "dj" done unconditionally and "identify"/"qualification" done when tiles exist | R1-R13 | V | T-UI-08, T-UI-09 |
| F-UI-11 | Diagnostics tabs are strings; no Track Resolver tab; no DJ Event Inspector; metrics forced (`djUpdateRateHz = 1`, `djStateAgeMs = 0`); empty device maps; false "read-back verified" | R1-R13 | V | T-UI-10, T-OPS-03 |
| F-UI-12 | Ergonomics: 12 to 14 px text, 32 px controls, Live dominated by the manual lane; readability from several feet unverified | R5 R13:UI-14 | V | T-UI-12 |
| F-UI-13 | `isModalAllowed` is unused; the Toaster mounts unconditionally; no-modal policy is not enforced | R11 | V | T-UI-12 |
| F-UI-14 | None of the 14 required reusable components (spec 142) exists | R11 | V | T-UI-01 |
| F-UI-15 | Status bar lacks timing health, Govee n of m, FPS and latency (spec 89) | R5 | V | T-UI-02 |
| F-UI-16 | No analysis readiness explanation (spec 137) and no preanalysis queue UI (spec 139) | R1-R13 | V | T-UI-05 |
| F-UI-17 | No Settings screen (owner request: every configuration visible) | OWN | V | T-CFG-05, T-UI-11 |
| F-UI-18 | The manual lane's consumer "party" aesthetic sits on the Live surface, contrary to spec 88 and 151 | R5 | V | T-UI-04 |
| F-UI-19 | No explicit, badged simulator mode for demos without hardware | PLAN | V | T-UI-15, T-TRU-02 |

## 19. Persistence (F-DATA)

| ID | Finding | Sources | Ver | Closed by |
| --- | --- | --- | --- | --- |
| F-DATA-01 | The `Store` is never opened by the app; default path `:memory:`; WAL pragma inert | R1-R13 | V | T-DATA-01 |
| F-DATA-02 | Uses `node:sqlite`; spec 80 requires better-sqlite3 with Kysely | R1-R13 | V | T-DATA-01 |
| F-DATA-03 | 7 of 17 spec 81 tables; no migrations; `analysis_artifacts` keyed by track only; plan cache key lacks style hash, source fingerprint and venue class | R1-R13 | V | T-DATA-02, T-DATA-03 |
| F-DATA-04 | Fast path returns an artifact path as `trackJson` | R13:DATA-03 | V | T-DATA-04 |
| F-DATA-05 | Contracts validate shape only: duplicate or unsorted beats, reversed ranges, events beyond duration, inconsistent segment counts all pass | R13:DATA-04 | V | T-DATA-05 |
| F-DATA-06 | Session recorder records scan, identify and chase only; no DJ observations, decisions, frame hashes or health; no export or replay; `shift()` on a 100k array | R13:DATA-05 | V | T-DATA-06 |
| F-DATA-07 | `safeStorage` unused; no Govee API key storage | R1-R13 | V | T-SEC-01 |
| F-DATA-08 | No settings persistence | OWN | V | T-CFG-02 |

## 20. Security (F-SEC)

| ID | Finding | Sources | Ver | Closed by |
| --- | --- | --- | --- | --- |
| F-SEC-01 | No content security policy, renderer sandbox flag, navigation guards or IPC sender checks | PLAN | V | T-SEC-03 |
| F-SEC-02 | Read-only access to Rekordbox and Serato data is a convention, not enforced at open | R13:DJ-01 | V | T-SEC-04 |
| F-SEC-03 | Memory reading (rkbx_link or the clean-room reader) requires re-signing Rekordbox and elevated privileges; no consent flow or audit exists | R7 PLAN | V | T-SEC-05, T-LIVE-11 |
| F-SEC-04 | BLE encrypted-link keys are vendor constants published in an MIT repo; shipping them is an owner decision | PLAN | V | T-BLE-07 |

## 21. Operations and packaging (F-OPS)

| ID | Finding | Sources | Ver | Closed by |
| --- | --- | --- | --- | --- |
| F-OPS-01 | Structured logging (spec 130) is a helper nobody calls; no log files, rotation or diagnostic mode | R13:DATA-05 | V | T-OPS-02 |
| F-OPS-02 | Spec 131 metrics are not measured | R1-R13 | V | T-OPS-03 |
| F-OPS-03 | Graceful shutdown and ending look (spec 133) absent | R1-R13 | V | T-ARC-03 |
| F-OPS-04 | Update strategy (spec 145) absent | R13:DATA-06 | V | T-OPS-04 |
| F-OPS-05 | No packaging: no electron-builder or Forge, signing, notarization, installer, bundled uv/Python/FFmpeg/models/native addons, `asarUnpack`, entitlements | R1-R13 | V | T-OPS-05 |
| F-OPS-06 | No clean-machine install test | R1-R13 | V | T-OPS-06 |
| F-OPS-07 | README says "Node.js 22 (see package.json engines)" but there is no `engines` field; Electron bundles its own Node | R8 PLAN | V | T-TRU-17 |
| F-OPS-08 | CI: pytest red, Playwright Chromium installed and unused, no lint, no coverage, no packaging job | R11 R13:QA-07 | V | T-TRU-11 |
| F-OPS-09 | No crash handling or safe-state policy (spec 133) | R13:APP-01 | V | T-OPS-07 |
| F-OPS-10 | macOS 15+ Local Network privacy prompt (`NSLocalNetworkUsageDescription`) is required for LAN discovery from a packaged app; not handled | PLAN | U | T-OPS-05 |

## 22. Tests and CI (F-QA)

| ID | Finding | Sources | Ver | Closed by |
| --- | --- | --- | --- | --- |
| F-QA-01 | Vitest collects compiled `dist` tests: 214 executions, about 111 unique tests | R1-R13 | V | T-TRU-07 |
| F-QA-02 | Playwright "E2E" imports functions and never launches Electron; the blackout test is `expect(true).toBe(true)` | R1-R13 | V | T-TRU-15, T-QA-02 |
| F-QA-03 | "4h soak" is 864,000 synchronous iterations in about 21 s; `soak()` resets `pending` every iteration so `maxPending <= 1` is guaranteed | R1-R13 | V | T-TRU-15, T-QA-06 |
| F-QA-04 | Goldens are sparse; one renderer hash; planner golden self-writes; several determinism tests compare output to itself | R11 R13:QA-05 | V | T-QA-10 |
| F-QA-05 | Simulator, fault and performance tests are not application-level; no measured spec 117 to 119 targets | R1-R13 | V | T-QA-04, T-QA-05, T-QA-07 |
| F-QA-06 | Cross-platform CI proves builds only; AX follow is macOS-only and silently absent on Windows | R13:QA-07 | V | T-QA-11, T-LIVE-06 |
| F-QA-07 | No property tests (fast-check or Hypothesis) | R11 | V | T-QA-12 |
| F-QA-08 | No coverage measurement despite AGENTS.md gates (line 85, branch 80, function 90, mutation 75) | R11 | V | T-TRU-07, T-TRU-08 |
| F-QA-09 | The `translateBlackout` test uses `SIDE`, an input the planner never produces | R5 | V | T-MIX-04 |
| F-QA-10 | No analysis golden tests | R11 | V | T-ANA-16 |
| F-QA-11 | Replay "speed" (1x, 2x, 10x, step) only rescales synthetic timestamps | R13:QA-06 | V | T-QA-03 |
| F-QA-12 | No recording or fault-injecting transport; no hardware-in-the-loop harness | R10 | V | T-GOV-14, T-QA-04 |
| F-QA-13 | No curated visual validation set (spec 116) or review tooling | R1-R13 | V | T-QA-09, T-QA-13 |
| F-QA-14 | Tooling recommendations (Knip, dependency-cruiser, CodeQL, Semgrep and ast-grep rule packs, Stryker, mutmut, Playwright Electron, capability manifest, claim tests, runtime invariants, recording and fault transports, timing harness, staged CI) not adopted | R10 | V | T-TRU-04 to T-TRU-12 |

## 23. Documentation (F-DOC)

| ID | Finding | Sources | Ver | Closed by |
| --- | --- | --- | --- | --- |
| F-DOC-01 | `docs/*.md` other than SPEC, the capture log and ADR-001 are 3 to 5 line stubs; the owner's "DOCUMENT EVERYTHING" was not honoured | R1-R13 OWN | V | T-DOC-01 |
| F-DOC-02 | README capability table over-claims (see briefing section 1) | R1-R13 | V | T-TRU-05 |
| F-DOC-03 | README says spec covers sections 1 to 150; it has 155 | PLAN | V | T-DOC-01 |
| F-DOC-04 | ADR-001 chose AX and ProLink and omitted rkbx_link; needs superseding ADRs for every decision switch | R1-R13 | V | T-DOC-02 |
| F-DOC-05 | `vendor/README.md` claims the codec is implemented and tested | PLAN | V | T-DOC-01 |
| F-DOC-06 | CONTRIBUTING describes E2E and replay practices the repo does not have; AGENTS.md repository memory has TBD canonical commands and an empty scars section | PLAN | V | T-DOC-03 |
| F-DOC-07 | No `THIRD_PARTY_NOTICES` | R7 | V | T-DOC-04 |

## 24. Configuration and decisions, owner request (F-CFG, F-DEC)

| ID | Finding | Sources | Ver | Closed by |
| --- | --- | --- | --- | --- |
| F-CFG-01 | Operational values are hardcoded across the codebase (seek thresholds, clock health 500/2000 ms, introduction 0.05/0.3/0.7, blackout translation 0.3, overlay 0.2, section energies, cooldowns, chase period, build windows, drop thresholds, silence thresholds, band edges, FFT sizes, scan timeouts, poll intervals, ports, cursor interval, blinder period, tile metrics, FPS backoff floor, gamma, shape curve, recorder capacity, AGC constants, director cooldowns) | OWN PLAN | V | T-CFG-04 |
| F-CFG-02 | No configuration file and no UI to see or change any of it | OWN | V | T-CFG-01, T-CFG-02, T-CFG-05 |
| F-DEC-01 | Where there is a choice between approaches, implement each, plus a combined mode, behind a visible switch | OWN | V | T-CFG-06 and every task listed in the decision catalog |

## 25. Review claims verified false or unverified (do not act on these as stated)

| ID | Claim | Source | Status | Truth |
| --- | --- | --- | --- | --- |
| F-X-01 | `follow.ts` polls master.db mtime every 2000 ms through `rekordbox-connect` | R3 | X | `follow.ts` is AX scraping plus a ProLink listener; `rekordbox-connect` is not installed |
| F-X-02 | Rekordbox database access "WORKING" in `packages/rekordbox-library` | R2 | X | Helpers only; nothing opens master.db (F-RBL-01) |
| F-X-03 | FLX4 telemetry "WORKING" | R2 | X | No MIDI I/O (F-FLX-01) |
| F-X-04 | ANLZ parsers live in `packages/rekordbox-library/src/anlz/` | R2 | X | ANLZ parsing is Python `native.py` through pyrekordbox |
| F-X-05 | `govee-lan.ts` does multicast only | R2 R3 | X | It sends multicast, optional broadcast addresses, global broadcast and remembered-IP unicast (partially broken, F-GOV-07) |
| F-X-06 | govee2mqtt `quirks.rs` declares `segment_rgb: 0..14` for H6076 | R4 | X | `quirks.rs:300` is `Quirk::lan_api_capable_light("H6076", FLOOR_LAMP)`; no segment table exists |
| F-X-07 | H6076 has exactly 14 addressable razer segments and H1A45 has 12 | R3 R4 | U | Govee product material says 14 segmented controls for H6076 (spec 42); nothing verifies razer zone counts or H1A45. Measure per unit (T-GOV-11) |
| F-X-08 | Razer arm frame is `BB 02 B1 01 xor` and frames are `BB len B0 ...` with 1-byte length | R3 R4 | X | Pinned toolkit: 16-bit payload-only length, XOR over all preceding bytes including `BB`, inside `{"msg":{"cmd":"razer","data":{"pt":"<base64>"}}}`; arm is `bb 00 01 b1 01 0a` |
| F-X-09 | "H6076 ignores razer; single-zone over LAN" and "H6076 accepts razer at 14 segments" | R2 repo R3 | U | Both unverified. Probe per unit (T-GOV-10) |
| F-X-10 | `store.ts` initial state is pre-populated from `test-fixtures` | R3 | X | Store starts with `live: null`; `resolve-live.ts` fetches fixtures (F-APP-03) |
| F-X-11 | Python analysis falls back to synthetic sinusoids and pseudo-random markers when models are missing | R3 | X | It returns `None` and skips ML; the defect is silent `full` labelling (F-ANA-04) |
| F-X-12 | Serato "PARTIAL/wrapped" transport | R2 | X | Parsers only; no transport (F-SER-01) |
| F-X-13 | The cloud comment "10/min/device" contradicts a researched "2 requests per second" | R11 | X | Govee documents 10 per minute per device and 10,000 per day per account; make both configuration (F-GOV-17) |
| F-X-14 | "Per-segment colour requires the cloud" | R12 | X | True for the official LAN JSON API; the undocumented razer channel and BLE masked writes carry segments locally, per unit |
| F-X-15 | "Venue canvas provides basic positioning" | R2 | X | No positioning exists (F-VEN-02) |
| F-X-16 | "Electron boots cleanly under xvfb" | R11 | U | Reported by R11; R1 could not launch Electron (binary download blocked). Re-verify in T-QA-02 |
| F-X-17 | "Some H6076 revisions dropped LAN in firmware" | R12 | U | Community report; mitigated by per-unit probing (F-GOV-24) |
| F-X-18 | "Rekordbox 7.2.10 predates the SoundSwitch integration" | R3 | C | Consistent with spec 8 (7.2.19 introduced it) |
| F-X-19 | UI built with Tailwind v4, shadcn and Radix | R2 | C | True (`apps/desktop/package.json`, `components/ui/*`) |
