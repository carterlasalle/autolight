# WP10. Analysis worker, ML, DSP, events, fusion and readiness

Spec sections: 2.2, 2.3, 13 to 25, 70, 82, 85, 109, 137, 139, 140.
Findings closed: F-ANA-01 to F-ANA-29 (F-ANA-25 is in `wp00`), F-QA-10.

## 0. What went wrong last time, specifically

- A `NameError` inside `except Exception: pass` silently discarded every ML
  structure event while the analysis was labelled `full` (F-ANA-01, F-ANA-04).
- A track with readable audio but no ANLZ produced an empty zero-duration
  model without decoding the audio (F-ANA-02), and that model is rejected by
  the TypeScript schema (F-ANA-03).
- "Stems" are FFT band proxies; All-In-One's session API is unused and its
  outputs are discarded; Beat This is invoked with the wrong CLI syntax.
- Only five detector event types (build start, drop, fake drop, breakdown,
  silence) are ever emitted, plus a fake `section-transition` at beat 1 that
  stands in for GRID_WARNING; 19 are required. Beat aggregation ignores beat
  timestamps; evidence is computed and then stripped.
- The client that should run the worker is never instantiated, loses job
  inputs on requeue, and resolves its project with a relative path.

## 1. Required reading

| Source | What to take |
| --- | --- |
| `openmirlab/all-in-one-infer` source | The persistent session API, outputs (tempo, beats, downbeats, boundaries, labels, stems, 100 Hz activations, embeddings), device handling, weight download location and license |
| `CPJKU/beat_this` source and README | Python inference API and CLI flags (output is `-o`), output format (beats and downbeats), weights and license |
| `analysis/src/autolight_analysis/*.py` | Current code; every function's real callers |
| `docs/SPEC.MD` 13 to 25 and 70 | Normative feature and event lists |
| FFmpeg documentation for `-f f32le`, resampling (`aresample`, soxr) and decoder delay (`start_time`, priming samples) | Canonical decode |

## 2. Capability accounting (readiness inputs)

Every artifact carries `analysisCoverage.inputs`, one entry per key below,
each `{ status: "present" | "absent" | "failed" | "skipped"; reason?: string;
version?: string; durationMs?: number }`. Readiness (spec 70, 137) is
computed only from this list, in one function shared by Python and
TypeScript through generated code, and is never set by hand.

| Key | Meaning |
| --- | --- |
| `source.audio` | Source audio readable and decoded canonically |
| `native.rekordbox.grid` | PQTZ beat grid |
| `native.rekordbox.pssi` | PSSI phrases |
| `native.rekordbox.cues` | PCO2 cues and loops |
| `native.rekordbox.waveforms` | PWAV, PWV2 to PWV7 |
| `native.rekordbox.vocal` | PWVC |
| `native.serato.grid` | Serato BeatGrid |
| `native.serato.markers` | Serato Markers2 |
| `ml.allinone.structure` | Boundaries and labels |
| `ml.allinone.metrical` | Beats, downbeats, tempo |
| `ml.allinone.activations` | 100 Hz activations |
| `ml.allinone.embeddings` | Embeddings |
| `ml.stems` | Source-separated stems (not proxies) |
| `ml.beatthis` | Beat This beats and downbeats |
| `dsp.features` | The 22 spec 18 features |
| `dsp.stemProxies` | Band proxies (used only when `ml.stems` is not present, DS-10) |
| `events.detectors` | Event detection ran over the fused structure |
| `fusion.structure` | Sections fused with provenance |
| `plan.generated` | A ShowPlan compiled from this model (filled by the planner side) |

Levels: `FULL` requires a DJ grid, `source.audio`, at least one native
structure input, `ml.allinone.structure`, `dsp.features`,
`events.detectors` and `plan.generated`. `STRUCTURED` requires a DJ grid,
native structure (PSSI) and `plan.generated` without accessible audio, or
with audio but without ML. `ADAPTIVE` is everything else (DJ beat and live
audio only). The click-through in the Library (spec 137) lists every key with
its status and reason.

## 3. Tasks

### T-ANA-01 Worker protocol that cannot be corrupted or killed by one bad line

- Closes: F-ANA-21.
- At worker start, duplicate the original stdout file descriptor for the
  protocol and point `sys.stdout` (and the C-level fd 1) at stderr, so any
  library that prints cannot corrupt frames. Frames are newline-delimited
  JSON with a `v` protocol version and a request `id`.
- Every frame is parsed inside the error guard; a malformed frame produces a
  typed `error` frame with the offending line truncated, and the worker keeps
  running. Heartbeat frames every `analysis.worker.heartbeatMs`. Progress
  frames per stage. Cancellation by request `id`.
- Structured logging to stderr as JSON lines, which the supervisor forwards
  to the app log (`T-OPS-02`).
- DoD: pytest sends a malformed line, a line from a library print, and a
  valid request; the worker answers the valid request correctly and reports
  the malformed one; mutation testing on the frame loop.

### T-ANA-02 Supervisor, persistent job queue and the preanalysis queue

- Closes: F-ANA-20; probes `P-14-kill-worker`, `P-139-queue`; spec 109, 139.
- Replace `AnalysisClient` with an `AnalysisSupervisor` in the main process:
  resolves the worker command from the path service (packaged: bundled `uv`
  and the bundled project; development: the repo's `analysis` directory),
  never a relative path (S24); starts, monitors heartbeats, restarts with
  backoff (`analysis.worker.restartBackoffMs`); keeps a persistent job queue
  in the database (`analysis_jobs`, `T-DATA-02`) with every input (track ID,
  audio path, native metadata paths, requested stages, config snapshot hash);
  requeues interrupted jobs with identical inputs; enforces
  `analysis.worker.jobTimeoutMs`; supports cancel, priority (a track loaded
  on a deck jumps the queue), and concurrency (`analysis.worker.concurrency`).
- Job states exactly as spec 139: `Queued`, `Analyzing`, `Compiling`,
  `Ready`, `Failed` (with typed reason). Artifacts persist between sessions.
- Spawn errors, exits and timeouts are typed statuses in Diagnostics; the
  show host is never affected (PyTorch never runs in the show process).
- DoD: `P-14-kill-worker` (100 random kills during a batch of 20 jobs: zero
  lost jobs, all complete with the same outputs as an uninterrupted run, show
  host tick jitter unchanged); integration test: queue a playlist, restart the
  app mid-batch, and every job resumes in the right state from the database.
  The queue UI probe `P-139-queue` is proven in `T-UI-05`.

### T-ANA-03 Canonical decode

- Closes: F-ANA-08; probe `P-15-canonical-decode`.
- One FFmpeg pipeline for every source: decode to 44.1 kHz, 32-bit float,
  stereo (`-f f32le -ar 44100 -ac 2`, resampler configurable
  `analysis.decode.resampler`), write to the cache as a raw float file plus a
  JSON sidecar (frames, duration, decoder, FFmpeg version, measured start
  offset); the mono stream is derived from this decode, never decoded
  separately.
- Cache key: content hash of the source file plus decode settings, not the
  path. Decoder delay: measure the start offset (priming samples, `start_time`)
  and record it; the analysis timebase and the DJ grid are aligned through it
  and the difference is reported per file.
- FFmpeg is bundled in the packaged app (`T-OPS-05`) and located through the
  path service.
- DoD: tests on generated MP3, AAC, FLAC and WAV encodings of the same
  signal: canonical frames align within one sample after offset correction;
  editing a file's audio changes the key, editing its tags does not.

### T-ANA-04 Every input shape produces the right model or a typed failure

- Closes: F-ANA-02, F-ANA-03, F-ANA-23.
- Readable audio with no ANLZ runs the full pipeline (decode, ML, DSP,
  events) and produces a model whose grid comes from ML (labelled as not a DJ
  grid, spec 2.2) with readiness computed honestly.
- No readable audio with ANLZ produces a `STRUCTURED` model from native data.
- Neither produces an `ADAPTIVE` model that the TypeScript schema accepts (an
  empty grid is valid for ADAPTIVE; the schema is a discriminated union by
  level).
- A nonexistent file returns a typed `failed` result with reason
  `audio-missing`, not `complete`.
- DoD: one test per shape in pytest plus the TypeScript schema test on the
  produced artifacts.

### T-ANA-05 All-In-One persistent session and model management

- Closes: F-ANA-05, F-ANA-07, F-ANA-22, F-ANA-29; probe
  `P-16-allinone-session`.
- Use the upstream persistent session API so weights load once per worker
  life (measure: model load count equals 1 across a batch). Device selection
  by `analysis.device` (`auto`: CUDA when available, CPU otherwise; macOS
  CPU per spec 16). Record the device used in the artifact.
- Retain every output: tempo, beats, downbeats, boundaries with
  probabilities, labels with probabilities, stems (see `T-ANA-06`), 100 Hz
  activations and embeddings (written to the feature artifact, referenced
  from the model).
- Model management: weights are downloaded only in Setup or by an explicit
  "prepare analysis" action, into `analysis.ml.modelCacheDir`, with checksum
  verification, a size and license notice shown to the owner, progress, and
  resume. `analysis.ml.offlineOnly` prevents any download during Live. A
  pre-warm step loads the session in the background after startup when the
  preanalysis queue is non-empty.
- Record each model's license in `THIRD_PARTY_NOTICES` and in Settings; if a
  license forbids redistribution, the installer does not bundle it and Setup
  downloads it with the owner's consent.
- DoD: `P-16` on the CI ML job (`uv sync --frozen --all-groups`); offline
  test proves no network access during Live (network namespace or a blocked
  socket factory in the test).

### T-ANA-06 Real stems with labelled fallback (DS-10)

- Closes: F-ANA-06.
- `allinone-stems`: use All-In-One's source separation (bass, drums, vocals,
  other), stored as stem RMS envelopes and features (not full audio unless
  `analysis.stems.keepAudio`).
- `band-proxies`: the existing FFT band approach, renamed to proxies
  everywhere and labelled `dsp.stemProxies`.
- `fusion` (default): real stems when available, proxies otherwise; features
  record which one they came from.
- DoD: tests on a synthetic mix of a bass sine, a kick pattern and a vocal
  formant signal show real stems separating better than proxies (metric:
  correlation with the known sources, recorded); readiness shows which ran.

### T-ANA-07 Beat This cross-check

- Closes: F-ANA-15; part of DS-12.
- Call Beat This through its Python inference API in the worker (preferred,
  reuses loaded weights) or its CLI with the correct flags (`-o`), selectable
  by `analysis.beatthis.invoke` (`api` default, `cli`); parse beats and
  downbeats with beat-in-bar derived from downbeat positions.
- DS-12: `beat-this`, `allinone-beats`, `both` (default) with an agreement
  vote feeding `T-ANA-08` and the downbeat confidence.
- DoD: test with a synthetic click track at a known tempo and meter: beats
  within 10 ms, downbeats correct.

### T-ANA-08 GRID_WARNING from a real comparison

- Closes: F-ANA-16; probe `P-17-grid-warning`.
- Compare the DJ grid to each metrical analyzer over all anchors: median and
  95th percentile offset, drift over time, downbeat agreement, and
  segments (for example "grid shifts by half a beat after bar 64"). Raise
  `GRID_WARNING` when disagreement exceeds `analysis.gridWarning.toleranceMs`
  over at least `analysis.gridWarning.minAnchors` anchors. Store a typed
  `gridWarnings[]` object with evidence and the affected beat range. Never
  alter the grid.
- Delete the fake `section-transition` at beat 1 and the duplicate append.
- DoD: `P-17` passes on a synthetic grid shifted after bar 64; an aligned grid
  raises nothing; the typed `gridWarnings[]` object round-trips through the
  schema. The Inspector badge is proven in `T-UI-06`.

### T-ANA-09 The 22 DSP features with correct aggregation

- Closes: F-ANA-09, F-ANA-10; probe `P-18-feature-suite`.
- Frame-level features at `analysis.frame.hop` and `analysis.frame.size`,
  every one of spec 18: integrated loudness proxy (K-weighted, EBU R128
  style, documented as a proxy), short-term RMS, bass, low-mid, mid and high
  energy (band edges `analysis.bands`), spectral centroid, rolloff, flux,
  onset strength, onset density, zero-crossing rate, kick-like and snare-like
  transient energy (band-limited onset detectors), bass, drum, vocal and
  other stem RMS (from `T-ANA-06`), silence probability, novelty (self
  similarity checkerboard on a feature matrix), dynamic range, energy
  derivative.
- Aggregation to sub-beat (`analysis.aggregate.subdivisions`, default 4),
  beat, bar and phrase using the actual beat timestamps from the grid (each
  beat's window is from its time to the next beat's time), with partial
  windows at the edges handled by their true length.
- Features stored in the feature artifact (frame series) and `beatFeatures`
  in the model (per beat, per bar, per phrase).
- Remove the five dead helpers or wire them in; no dead code.
- DoD: each feature has a unit test on a synthetic signal with an analytic
  expectation; property test: aggregating a constant signal gives the
  constant for any variable-tempo grid; the 1.4 s offset case from the old
  `resample_to_beats` is a regression test.

### T-ANA-10 Event detectors for all 19 events

- Closes: F-ANA-11, F-ANA-12, F-ANA-13, F-ANA-14; probes
  `P-22-event-vocabulary`, `P-23-build`, `P-24-drop`, `P-25-fake-drop`.
- Emit every spec 22 event with `beat`, `endBeat` where relevant,
  `strength`, `confidence` and `evidence[]`: major section transition, minor
  phrase transition, build start, build intensification, predrop, drop, fake
  drop (`fakeImpactBeat`, `actualImpactBeat`, variant: silence, vocal fake,
  held tension), drop continuation, breakdown, bass re-entry, drum re-entry,
  vocal entry, vocal exit (using `ml.stems` vocal RMS and PWVC), fill (PSSI
  fill flags plus onset density), pause, silence, large transient, final hit,
  outro release.
- Build detection per spec 23 over `analysis.build.windows` with all nine
  features (energy, drum density, high frequency, centroid, onset density
  slopes, bass movement, PSSI Up, boundary confidence, harmonic tension from
  `T-ANA-18`). Drop detection per spec 24 with every listed input and no
  single threshold (a weighted vote with `analysis.drop.*` config and
  evidence per input). Candidates are real downbeats from the grid
  (`beatInBar == 1`), not array index multiples.
- No restraint inside detectors (spec 2.3): detectors emit every candidate
  with confidence; the planner decides.
- DoD: `analysis/tests/test_events_full.py` on generated tracks with planted
  events (a generator in `analysis/tests/fixtures/make_tracks.py` renders
  builds, drops, fake drops at 1 to 4 beat offsets, breakdowns, re-entries,
  vocal entries and exits, fills, silences and a final hit from synthetic
  sources): each planted event detected within `qa.events.toleranceBeats`
  with recall and precision reported; thresholds for pass live in
  `T-ANA-16`.

### T-ANA-11 Fusion with provenance, and the swallowed error

- Closes: F-ANA-01, F-ANA-17, F-ANA-27; DS-11; probe `P-19-provenance`.
- Fix the `events` use-before-assign; remove every bare `except` (Ruff
  `BLE001`, `S110` from `T-TRU-09`), replacing them with named exceptions and
  input status entries.
- Fusion per spec 19: timing from the DJ grid; structure from PSSI plus
  All-In-One boundary and label probabilities plus feature boundaries plus
  event detector output, weighted by DS-11 (`pssi-first`, `ml-first`,
  `fused` default). When PSSI is absent, All-In-One labels form sections.
  Confidence is computed from agreement and source probabilities, not
  constants.
- Every section, phrase and event carries `evidence[]` with source tags in
  the spec 19 style (`rekordbox:PSSI:Up`, `allin1:boundary`,
  `energy:rising`).
- DoD: `P-19` contract test; a test with PSSI and ML disagreeing shows each
  DS-11 mode's result; a planted exception inside ML now appears as
  `ml.allinone.structure: failed` with the error, and readiness drops.

### T-ANA-12 TrackModel v2 in both languages from one definition

- Closes: F-ANA-03, F-ANA-11 (enum), F-ANA-17, F-ANA-24, F-RBL-04 (schema);
  probe `P-20-trackmodel-v2`.
- TypeScript Zod schema is the source of truth (spec 20 fields: schema and
  analyzer versions, identity, duration, metadata, beat grid, native analysis
  for Rekordbox and Serato, sections with raw labels, phrases, frame feature
  reference, beat features, musical events with the full event enum,
  evidence, grid warnings, analysis coverage with the input list). Generate
  JSON Schema from Zod and Python models from the JSON Schema
  (`datamodel-code-generator` through `uv run`), committed and checked for
  drift in CI.
- Zod schemas are strict (unknown fields are an error, not stripped) so a
  missing field in the schema cannot silently delete data again.
- Semantic validation (`T-DATA-05`): sorted unique beats, ranges ordered,
  events inside duration, segment counts consistent.
- DoD: `P-20` parity test (a v2 fixture parses in both languages, byte-equal
  after round trip); the old test that asserted evidence was absent is
  replaced.

### T-ANA-13 Artifact identity, versioning and atomic writes

- Closes: F-ANA-18; probe `P-82-invalidation` (analysis part).
- Duration from the decoded audio (not the last beat). Analyzer version from
  the package metadata (`importlib.metadata`), plus model versions. Artifact
  filename from the source fingerprint plus schema, analyzer and config hash.
  Writes go to a temp file and are renamed atomically. Cache directory from
  `analysis.cacheDir` (never `/tmp` by default).
- DoD: tests for each field; a crash between write and rename leaves the
  previous artifact intact.

### T-ANA-14 Numeric correctness fixes

- Closes: F-ANA-19.
- `silence_probability` is clamped to [0, 1] with a test at the old failing
  input (0.005 returned 1.5); `beat_aggregate` divides partial groups by their
  real size.
- Property tests with Hypothesis for both.
- DoD: property tests green; Bug Corpus entries for both.

### T-ANA-15 Readiness computed from inputs

- Closes: F-ANA-04, F-ANA-23; probes `P-70-levels`, `P-137-readiness`.
- Implement the capability accounting of section 2 in the worker and the
  shared readiness function; the Library, Inspector and Live screen read it
  (`T-UI-05`, `T-UI-02`). No code path sets `full` directly.
- DoD: tests for every combination of inputs mapping to the right level, in
  both languages through the generated code. The click-through UI is proven
  in `T-UI-05` (`P-137-readiness`).

### T-ANA-16 Analysis goldens and detection metrics

- Closes: F-ANA-26, F-QA-10.
- Goldens: for each generated planted-event track and each curated
  validation track (`T-QA-09`, owner-supplied, opt-in in CI), store the
  TrackModel summary (sections, events with beats, readiness) as a golden,
  updated only through `yarn golden:update --reason`.
- Metrics per event type on the generated set: recall and precision at
  `qa.events.toleranceBeats`; required minimums in config
  (`qa.events.minRecall`, `qa.events.minPrecision`, per type), measured and
  raised deliberately. The five committed real-track models with zero events
  are regenerated and must show events.
- DoD: a CI test fails when any event type's recall or precision on the
  generated set falls below its `qa.events.minRecall` or
  `qa.events.minPrecision` value (red run saved with a deliberately weakened
  detector); metrics JSON in evidence; goldens committed with reasons.
  Lowering a threshold needs a recorded reason and the owner's approval, as
  for coverage thresholds.

### T-ANA-17 Dependency groups, lockfile and packaging of the worker

- Closes: F-ANA-04 (ML install part); probe `P-85-frozen`.
- CI and packaging use `uv sync --frozen --all-groups`. The packaged app
  ships `uv`, a pinned Python and the locked environment (or builds it at
  first run from the bundled wheel cache offline); the ML group is installed
  as part of "prepare analysis" with progress. No pip anywhere.
- DoD: clean-VM install (`T-OPS-06`) prepares the worker and analyzes a track
  without network after the weight download.

### T-ANA-18 Harmonic tension proxy and key

- Closes: F-ANA-14, F-ANA-28.
- Chroma (CQT based) per frame; key estimate with confidence (profile
  correlation, documented algorithm, our own code); a harmonic tension proxy
  per beat (for example tonal distance from the estimated key centre plus a
  dissonance measure), aggregated like other features and fed to build
  detection.
- DoD: tests on synthetic chord progressions (tension rises on a dominant,
  resolves on the tonic); key accuracy on generated tonal material above
  `qa.key.minAccuracy`.

## 4. Config keys added (added to `03` sections 3.5 and 3.11)

`analysis.decode.resampler` (`soxr`), `analysis.beatthis.invoke` (`api`),
`analysis.aggregate.subdivisions` (4), `analysis.stems.keepAudio` (false),
`qa.events.toleranceBeats` (1), `qa.events.minRecall` (per type map),
`qa.events.minPrecision` (per type map), `qa.key.minAccuracy` (0.7). All
unmeasured targets.
