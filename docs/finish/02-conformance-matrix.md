# 02. SPEC conformance matrix (sections 1 to 155)

One row per SPEC section. Each row names a **failing probe**: a test (or, for
physical requirements, a measured procedure) that fails on the current code and
must pass when the section is done. Write the probe first, run it, save the red
output in the task's evidence folder, then implement.

Probe naming: `P-<section>-<slug>`. The "Where" column is the file the probe
lives in. `E2E` means a Playwright test that launches the real Electron app via
`_electron.launch` (T-QA-02). `HW` means a hardware runbook in
`wp15-verification-qualification.md` with a measurement JSON as its output.
`SIM` means the probe runs against the protocol simulators on real sockets.

Status legend used in "Now": **Missing**, **Stub** (shape without behaviour),
**Wrong** (implemented against the spec), **Partial**, **OK** (keep, but still
covered by regression tests).

## Part A. Product and principles (sections 1 to 3)

| Sec | Requirement | Now | Failing probe (Where) | Definition of done and metric | Tasks |
| --- | --- | --- | --- | --- | --- |
| 1 | Knows loaded tracks per deck, position, beatgrid; analyzes whole song; plans; adapts to rig; follows manipulation; mixes two decks; renders segmented Govee frames; micro-reactive overlay; stays coherent through loops, seeks, cues, tempo, scratch, deck switch, network loss, reconnects, partial metadata | Stub | `P-1-normal-night` (E2E + SIM): the section 150 script run against simulators | Every step of `99-final-acceptance.md` section 3 passes on SIM; HW version passes on the owner's rig | T-QA-11 owns the probe (every task contributes) |
| 2.1 | Future knowledge first: the drop at beat 257 is known at beat 225 and drives build progression, pre-impact darkness, palette evolution, foreshadowing, second-drop variation | Wrong (planner never uses future events beyond one cue) | `P-2.1-future-aware-build` (`packages/show-planner/src/hierarchy.test.ts`): for a model with drop at 257 and build start 225, the plan contains staged cues in 225 to 256 with increasing density and a darkness cue ending exactly at 257 | Plans for every validation track show staged builds before every detected drop with confidence above `planner.drop.minConfidence` | T-PLAN-03, T-PLAN-06 |
| 2.2 | DJ beatgrid is timing truth; ML only validates; canonical time in beats | Partial (grid wins; 0/1-based origin mismatch; GRID_WARNING fake) | `P-2.2-grid-truth` (`packages/contracts/src/beat.test.ts`): phrase start beat 1 maps to grid anchor `index 0` time exactly; property test: `beatToSourceSeconds(sourceSecondsToBeat(t)) == t` within 1e-6 s over variable-tempo grids | One documented beat origin; round-trip property holds over 10,000 generated grids; no code path replaces the grid | T-RBL-03, T-ANA-08 |
| 2.3 | Analysis produces evidence; only the planner issues lighting decisions; no DSP issues STROBE | Partial (analysis detector applies "restraint"; live audio path undefined) | `P-2.3-no-dsp-directives` (ast-grep rule + `analysis/tests/test_boundary.py`): analysis output contains no lighting vocabulary; `reactive-audio` exports no cue constructors | Rule in CI; detectors emit every candidate with confidence; restraint only in planner | T-ANA-10, T-AUD-03, T-TRU-06 |
| 2.4 | Hierarchical decisions track, section, phrase, bar, beat, sub-beat | Missing | `P-2.4-six-levels` (`show-planner/src/hierarchy.test.ts`): plan has cues tagged with `level` for all six levels on a validation track | Every compiled plan on the validation set has level coverage; diagnostics show counts per level | T-PLAN-03 |
| 2.5 | Darkness is a state: full, partial, spatial negative space, pre-impact, alternating, low holds, delayed reveals | Wrong (Math.max compositing makes partial darkness impossible) | `P-2.5-partial-darkness` (`packages/renderer/src/layers.test.ts`): LEFT blackout over an ALL look turns exactly the LEFT cells black | All seven darkness forms have primitives, renderer support and golden frames | T-REND-01, T-PLAN-04 |
| 2.6 | Repetition has musical purpose; planner keeps visual memory | Wrong (occurrence parity) | `P-2.6-motif-return` (`show-planner/src/recurrence.test.ts`): chorus 2 reuses chorus 1's motif ID with at least one declared variation; two dissimilar sections never share a motif | MotifMap present; similarity threshold is config; validation review confirms | T-PLAN-08 |
| 3 / 3.1 | Use `serato-connect` directly for Remote (Bonjour, auth, OSC, delimiter, playhead, rate, BPM, loops, rolls, faders, four decks, coalescing) plus Serato files for grid, cues, loops, crates; write no duplicate | Missing | `P-3.1-serato-connect` (SIM, `packages/serato/src/provider.test.ts`): emulated Serato Remote session produces DeckState for 4 decks through serato-connect | Section 121 matrix passes on SIM; HW runbook passes | T-SER-01 to T-SER-06 |

## Part B. Rekordbox data (sections 4 to 12)

| Sec | Requirement | Now | Failing probe (Where) | Definition of done and metric | Tasks |
| --- | --- | --- | --- | --- | --- |
| 4 / 4.1 | Separate library plane and live plane; library via rekordbox-connect (options.json, SQLCipher key, read-only, WAL-aware, tracks, playlists, history, IDs, paths); DB never written | Missing | `P-4.1-readonly-library` (`packages/rekordbox-library/src/db.test.ts` against a generated SQLCipher fixture DB): opens read-only, lists tracks, playlists and history; an attempted write throws | Library reader works on the fixture DB and (HW) on the owner's library; write attempts are impossible by construction; both DS-15 modes agree on the fixture | T-RBL-01, T-RBL-02, T-SEC-04 |
| 5 | Resolve master.db row to AnalysisDataPath to DAT, EXT, 2EX; extract every useful field | Partial | `P-5-anlz-full` (`analysis/tests/test_native_full.py` on committed synthetic ANLZ files): every tag listed in 5.1 to 5.5 is present in the output with raw retained | All tags extracted with per-tag outcome; EXT variant falls back per tag | T-RBL-04 |
| 5.1 | PQTZ beat grid as canonical BeatGrid | OK (Python) | Covered by `P-2.2` and `P-5` | Unit brands and origin fixed | T-RBL-03 |
| 5.2 | PSSI mood, bank, endBeat, start beat, kind, type, fill flag, fill beat; normalize and keep raw | Partial (extracted, then dropped) | `P-5.2-pssi-retained` (`packages/contracts/src/trackmodel.test.ts`): a TrackModel produced by the worker contains `nativeAnalysis.rekordbox.pssi` with all fields | TrackModel v2 carries raw PSSI; one generated label table serves TS and Python | T-RBL-04, T-RBL-05, T-ANA-12 |
| 5.3 | PCO2 cue position, loop position, type, hotcue number, RGB colour, comment, loop quantization | Partial | `P-5.3-cues` (`analysis/tests/test_native_full.py`) | All seven fields present; comments available to planner as hints | T-RBL-04 |
| 5.4 | PWAV and PWV2 to PWV7 retained, especially PWV6 and PWV7 three-band | Missing (booleans) | `P-5.4-waveforms` (same file): arrays retained in the feature artifact with shape metadata | Inspector and waveform component render them | T-RBL-04, T-UI-02 |
| 5.5 | PWVC vocal information becomes evidence | Missing | `P-5.5-vocal` (same file) | Vocal lane exists; vocal entry and exit events use it | T-RBL-04, T-ANA-10 |
| 6 | `DJLiveProvider` contract; downstream never knows how state was obtained | Partial (interface exists, `onConnection(bool)` not `ProviderStatus`) | `P-6-provider-contract` (`packages/contracts/src/provider.test.ts`): every provider implementation passes the shared contract suite | All providers pass one contract suite; ProviderStatus typed | T-LIVE-01 |
| 7 | Provider priority: Lighting, then Composite FLX4, then adaptive fallback; both real providers implemented | Missing | `P-7-priority` (`packages/rekordbox-live/src/manager.test.ts`): with Lighting and Composite both emitting, Lighting wins; when Lighting stops for longer than `live.provider.staleMs`, Composite takes over; then adaptive | Fusion provider (DS-01) implements the order as default ranking and extends it with the owner's providers | T-LIVE-02 |
| 8 / 8.1 | Lighting provider implements the same state as the SoundSwitch integration without SoundSwitch at runtime | Missing | `P-8-lighting-provider` (replay): a committed real capture decodes to DeckStates | Decoder passes replay of every captured action; runtime needs no SoundSwitch process | T-LIVE-09 |
| 9 / 9.1 / 9.2 | Capture on 7.2.19+ with SoundSwitch 2.11+, FLX4, macOS and Windows; enumerate TCP, UDP, mDNS, Unix sockets, WebSockets, HTTP, pipes, fds, logs | Missing (log of one 7.2.10 session) | `P-9.2-surface-inventory` (HW runbook output `surfaces.json` per OS) | Capture tool produces inventory on both OSes; committed | T-LIVE-09 |
| 9.3 | 27 actions times 7 conditions, one action at a time from idle | Missing | `P-9.3-matrix-complete` (`protocol-fixtures` completeness test): every action/condition cell has a fixture | All cells present for macOS and Windows | T-LIVE-09 |
| 9.4 | Fixture format with raw capture and expectedEvents | Wrong (captures empty) | `P-9.4-capture-nonempty` (fixture lint): every fixture has non-empty raw capture and a decoder version | Fixture lint in CI | T-LIVE-09, T-TRU-15 |
| 9.5 | Decoder recovers full DeckState, retains unknown fields, stores raw in diagnostic mode | Missing | `P-9.5-decoder-fields` (replay): all DeckState fields populated where the capture has them; unknown fields preserved under `raw` | Replay passes; raw visible in DJ Event Inspector | T-LIVE-09, T-UI-10 |
| 10 | Composite FLX4 provider: library + FLX4 MIDI + native grid + Ableton Link + track-open observation + audio timing correction | Stub | `P-10-composite` (SIM: virtual MIDI + library fixture + Link peer): produces DeckState with play state, faders, estimated playhead and loaded track | Composite passes contract suite and section 119 SIM matrix rows it can support, with quality labels | T-LIVE-07, T-LIVE-12, T-FLX-06 |
| 11 | FLX4 observed non-exclusively; full control map; secondary truth; expressive cues inform the director | Stub | `P-11-flx4-map` (`packages/controller-flx4/src/map.test.ts` with recorded MIDI): every control in the list decodes with the right deck | Full map from the official document plus captures; hints reach director; never override playhead | T-FLX-01 to T-FLX-07 |
| 12 | Durable TrackId from native ID, path, file identity, decoded fingerprint; never title/artist alone | Stub | `P-12-rename-survives` (`packages/track-model/src/identity.test.ts`): renaming and retagging a fixture file keeps the same TrackId | Alias graph persisted; fingerprint computed at analysis | T-ID-01 to T-ID-03 |

## Part C. Analysis (sections 13 to 25)

| Sec | Requirement | Now | Failing probe (Where) | Definition of done and metric | Tasks |
| --- | --- | --- | --- | --- | --- |
| 13 | Analysis in `analysis/` with uv; no pip | OK | `P-13-uv-only` (CI grep for pip usage) | Rule in CI | T-TRU-06 |
| 14 | Dedicated Python worker, framed JSON over stdio, artifacts by file; crash keeps playback, compiled shows unaffected, restart, requeue; no PyTorch in show process | Stub (client never used; requeue loses paths) | `P-14-kill-worker` (integration, `packages/analysis-client/src/supervisor.test.ts`): kill the worker mid-job; job restarts with identical inputs and completes; show host tick jitter unaffected | Restart within `analysis.worker.restartBackoffMs`; zero lost jobs across 100 random kills | T-ANA-01, T-ANA-02 |
| 15 | Same FFmpeg pipeline for every source: 44.1 kHz float stereo canonical plus mono | Wrong (integer WAV, separate decodes, path-keyed cache) | `P-15-canonical-decode` (`analysis/tests/test_decode.py`): canonical artifact is f32 stereo 44.1 kHz; mono derived from it; cache key is content hash | Decoder delay offset measured and recorded per file | T-ANA-03 |
| 16 | All-In-One persistent session; tempo, beats, downbeats, boundaries, labels, four stems, 100 Hz activations, embeddings; CPU on macOS, CUDA on CUDA | Wrong | `P-16-allinone-session` (`analysis/tests/test_allinone_session.py`, ML group): one session analyzes three files without reloading weights; all outputs persisted | Session reuse measured (model load count equals 1); device selection recorded | T-ANA-05, T-ANA-06 |
| 17 | Beat This cross-check; GRID_WARNING in Track Inspector; never alter grid | Wrong | `P-17-grid-warning` (`analysis/tests/test_gridcheck.py`): a grid shifted by half a beat after bar 64 raises GRID_WARNING with evidence | Warning object in TrackModel; Inspector badge; Library status | T-ANA-07, T-ANA-08, T-UI-06 |
| 18 | 22 DSP features at frame level, aggregated to subbeat, beat, bar, phrase | Partial | `P-18-feature-suite` (`analysis/tests/test_features_full.py`): every feature exists with correct timebase; beat aggregation uses beat intervals from the grid | All 22 present; aggregation property tests | T-ANA-09 |
| 19 | Native timing wins; structure fused; every derived result carries provenance | Wrong (evidence stripped) | `P-19-provenance` (contract test): every section and event has `evidence[]` with source tags | Evidence visible in Inspector | T-ANA-11, T-ANA-12 |
| 20 | Immutable versioned TrackModel with metadata, nativeAnalysis, sections, phrases, frameFeatures, beatFeatures, events, coverage | Partial | `P-20-trackmodel-v2` (`packages/contracts/src/trackmodel.test.ts` plus Python mirror test): v2 fixture parses in both languages | Generated Python schema from TS; parity test | T-ANA-12, T-ANA-13 |
| 21 | Normalized section vocabulary with original label | OK | Regression in `P-20` | Keep | T-ANA-11 |
| 22 | 19 event types detected | Wrong (5 emitted) | `P-22-event-vocabulary` (`analysis/tests/test_events_full.py` on synthetic generated tracks with each event planted) | Each planted event detected within tolerance (see T-ANA-16 metrics) | T-ANA-10 |
| 23 | Build detection over 8, 16, 32 windows with nine features; BuildEvent with impactBeat, strength, confidence | Partial | `P-23-build` (same) | Recall and timing metrics in T-ANA-16 | T-ANA-10, T-ANA-18 |
| 24 | Drop from converging signals; confidence and strength separate | Partial | `P-24-drop` (same) | Metrics in T-ANA-16 | T-ANA-10 |
| 25 | Fake drop with fakeImpactBeat and actualImpactBeat, 1 to 4 beats | Wrong | `P-25-fake-drop` (same): delayed impacts of 1, 2, 3, 4 beats each detected | All four offsets detected; fields named per spec | T-ANA-10 |

## Part D. Planning (sections 26 to 37)

| Sec | Requirement | Now | Failing probe (Where) | Definition of done and metric | Tasks |
| --- | --- | --- | --- | --- | --- |
| 26 | Planner takes TrackModel, VenueModel, ShowStyle and outputs ShowPlan; sends no frames | Partial (no venue input) | `P-26-planner-inputs` (type test): `planShow(track, venueClass, style)` signature | Signature and package boundary rule | T-PLAN-01 |
| 27 | Same track, planner version, style, venue class gives the same base show; seed from track fingerprint | Wrong (seed from DB ID; no venue class) | `P-27-seed-fingerprint` (`show-planner/src/determinism.test.ts`): two identities with the same fingerprint give identical plans | Seed provenance recorded in plan | T-ID-02, T-PLAN-01 |
| 28 | Whole-song identity: palettes, neutral accent, spatial motif, movement vocabulary, baselines, budgets, in OKLCH/OKLab | Wrong (discarded) | `P-28-global-design` (`show-planner/src/identity.test.ts`): plan.globalDesign fully populated; renderer colours come only from it | Validation tracks show 2 to 3 core colours per track | T-PLAN-01, T-PLAN-02 |
| 29 | Colour changes because section, phrase or motif changed, not a timer | Wrong | `P-29-no-timer-colour` (diagnostics test): colour change events align with section/phrase/motif boundaries at 100% | Colour-change rate diagnostic | T-PLAN-02, T-REND-03 |
| 30 | Level responsibilities per hierarchy level | Missing | Covered by `P-2.4` plus `P-30-level-rules` (each level only changes its allowed attributes) | Rule table enforced in validator | T-PLAN-03, T-PLAN-10 |
| 31 | Stable primitive library of 27 primitives on abstract spatial groups | Stub (7 free strings) | `P-31-primitive-registry` (`show-planner/src/primitives.test.ts`): registry contains all 27 plus spatial primitives from WP05, each with renderer golden | All primitives rendered and golden-tested | T-PLAN-04, T-REND-02, T-ROOM-07 |
| 32 | Typed cue example (white-hit with attack, release, SpatialSelector) | Missing | `P-32-typed-cues` (type test) | Discriminated union | T-PLAN-01 |
| 33 | Eight explicit layers with precedence | Missing | `P-33-layer-stack` (`renderer/src/layers.test.ts`): manual override beats exclusive impact beats accents; master intensity scales last | Stack implemented with blend modes | T-REND-01 |
| 34 | Restraint engine with 11 state fields; can reject valid effects (white-hit four beats ago becomes colour impact) | Stub | `P-34-restraint` (`show-planner/src/restraint.test.ts`): the spec example | All fields tracked; reasons in diagnostics | T-PLAN-05 |
| 35 | Contrast engine: breakdown, build, final pre-drop, drop characteristics chosen by strength and history | Stub | `P-35-contrast` (frame-sampled diagnostics): breakdown mean brightness less than `planner.contrast.breakdownMaxMean`; build brightness slope positive | Metrics per section in diagnostics | T-PLAN-06 |
| 36 | Drop programming structure (staged ramps, desaturation, blackout 256 to 257, 90 ms white impact, quantized burst, saturated body) | Missing | `P-36-drop-sequence` (`show-planner/src/drop.test.ts` on the example model) | Sequence present; impact duration config in ms converted via tempo | T-PLAN-06 |
| 37 | Repeated sections reuse visual language with variation in direction, secondary colour, density, fixtures, accent timing | Wrong | `P-2.6` plus `P-37-variation-fields` | Variation fields recorded in MotifMap | T-PLAN-08 |

## Part E. Venue and Govee (sections 38 to 55)

| Sec | Requirement | Now | Failing probe (Where) | Definition of done and metric | Tasks |
| --- | --- | --- | --- | --- | --- |
| 38 | Fixture with topology, transform, cells, capabilities, calibration | Partial | `P-38-fixture-schema` (contracts test) | Schema v2 with room placement (WP05) | T-ROOM-02 |
| 39 | Cell with index, position, order, tags; logical segment or raw zone | Partial | `P-39-cell-mapping` (`packages/venue/src/cells.test.ts`) | Cells derived from calibration mapping | T-ROOM-02, T-ROOM-04 |
| 40 | Shared normalized coordinates so chases span devices | Partial | `P-40-cross-device-chase` (renderer golden with two lamps and a strip) | Owner's room golden passes | T-ROOM-05, T-REND-05 |
| 41 | Arbitrary groups plus 12 defaults; multi-membership | Partial | `P-41-derived-groups` (`venue/src/groups.test.ts`): LEFT is DJ-relative physical left | Groups derived from geometry plus user groups | T-ROOM-06 |
| 42 | H6076 segments discovered, not assumed; orientation confirmed by user | Wrong (14 assumed) | `P-42-h6076-discovery` (HW + SIM): segment count comes from qualification | No literal 14 in production code | T-GOV-11, T-GOV-13 |
| 43 | H1A45 topology discovered per unit (length, cut, firmware) | Missing | `P-43-h1a45-topology` (HW + SIM) | Per-unit calibration persisted | T-GOV-11, T-ROOM-04 |
| 44 | Pinned fork of govee-toolkit: Rust core, Node binding, LAN, BLE, cloud, razer streaming | Missing | `P-44-toolkit-loaded` (`packages/govee/src/toolkit.test.ts`): `govee-toolkit` loads in the show host thread and opens a stream to the simulator | Dependency pinned; fork for profiles | T-GOV-01, T-GOV-13 |
| 45 | H6076 and H1A45 first-class tested profiles under our control | Missing | `P-45-profiles` (profile lint) | Profiles committed with measurement receipts | T-GOV-13 |
| 46 | LAN ports 4001, 4002, 4003; razer frame family; arm once, never power-cycle between frames | Wrong | `P-46-razer-bytes` (`packages/govee/src/razer.test.ts`): golden vectors equal toolkit output; `P-46-no-power-cycle` (recording transport) | Byte-exact vectors; zero `turn` commands while armed | T-GOV-02, T-GOV-08 |
| 47 | Blackout is RGB zeros with stream armed | Wrong | `P-47-blackout` (recording transport + SIM) | Zero power commands; stream still armed after 100 blackouts | T-GOV-09 |
| 48 | White hits are RGB 255 scaled; no CCT mode | Wrong risk | `P-48-white` (recording transport): no `colorwc` with kelvin during show | Rule enforced by runtime invariant | T-GOV-09 |
| 49 | Segment intensity through linear-light RGB scaling | Partial | `P-49-linear-light` (`renderer/src/color.test.ts`): (255,0,90) at 0.30 equals the linear-light expected bytes | Colour pipeline tests | T-REND-03 |
| 50 | Global brightness only for slow master; never per beat | Wrong | `P-50-no-beat-brightness` (recording transport): brightness command count over 60 s of show is below `govee.brightness.maxPerMinute` | Enforced by transport rate limiter | T-GOV-09, T-RUN-07 |
| 51 | Toolkit buffer interface, `setAll(Uint8Array)`, newest-state-wins, no stale queue | Wrong | `P-51-newest-wins` (SIM with slow device): pending depth never above 1; stale frames delivered equals 0 | Metrics recorded | T-GOV-08, T-GOV-14 |
| 52 | 16-step qualification; calibration key hardware ID + SKU + firmware; REQUALIFICATION REQUIRED | Stub | `P-52-wizard` (E2E + SIM): wizard runs all 16 steps against simulated device and persists results | HW runbook per unit | T-GOV-11, T-UI-09 |
| 53 | Resolutions logical, grouped, native; highest stable meeting refresh target | Missing | `P-53-resolution` (SIM with fps ceiling) | Selection with recorded evidence | T-GOV-15 |
| 54 | Per-device calibration record; per-unit latency | Partial (schema only) | `P-54-calibration-persist` (integration with DB) | Persisted and used by renderer | T-GOV-11, T-DATA-02 |
| 55 | Per-fixture latency compensation through current tempo; visible impact simultaneous | Wrong | `P-55-latency-global` (`renderer/src/latency.test.ts`): zero latency equals plain render; 50 ms latency shifts sample beat by tempo-correct amount without changing spatial fields | HW p95 spread below 50 ms | T-REND-04, T-QA-08 |

## Part F. Runtime and mixing (sections 56 to 71)

| Sec | Requirement | Now | Failing probe (Where) | Definition of done and metric | Tasks |
| --- | --- | --- | --- | --- | --- |
| 56 | Show runtime in its own worker thread; not the React thread; hrtime clock | Missing | `P-56-ui-freeze` (E2E): freeze the renderer for 5 s (`webContents.debugger` pause); recording transport keeps receiving frames at the logical rate | Tick jitter p99 below 5 ms during UI freeze | T-ARC-01, T-RUN-01 |
| 57 | Estimator P + (now - T) R with smooth small corrections and large-error events | Partial (formula only) | `P-57-estimator` (`show-runtime/src/estimator.test.ts`): noisy 30 Hz observations produce a beat trace with error below `runtime.estimator.maxErrorMs` and no backward steps while playing | Property tests | T-RUN-02 |
| 58 | Seek: reset interpolator, recompute beat, reconstruct plan state, cancel abandoned transients, output new state; no replay | Stub | `P-58-seek` (runtime test): hot cue jump from beat 300 to 64 renders the beat-64 state within one tick and drops the beat-300 white hit | Seek latency one tick | T-RUN-03 |
| 59 | Loops evaluate the region repeatedly with pass variation while preserving the section's visual identity | Stub | `P-59-loop` (runtime test with DeckState loop) | Pass A/B/A variation visible in frames; palette references and motif ID identical on every pass | T-RUN-04 |
| 60 | Tiny loops and rolls degrade by hardware refresh | Missing | `P-60-roll-degrade` (runtime test with 20 Hz fixture and 1/16 roll) | Degrade choices per config | T-RUN-04 |
| 61 | Reverse follows backward; scratch enters SCRATCH HOLD; resync at next sensible boundary | Wrong | `P-61-scratch` (runtime test with recorded jog trace) | Hold during scratch; resync at boundary | T-RUN-05 |
| 62 | Independent worlds per deck plus ShowMixer | Stub | `P-62-two-worlds` (runtime test) | Two cursors, one mixer | T-RUN-01, T-MIX-06 |
| 63 | Audible weight from upfader, crossfader, playing, master; FLX4 confirmation | Wrong | `P-63-crossfader` (`show-mixer/src/weight.test.ts`): crossfader hard left gives A 1, B 0; hard right gives A 0, B 1 for default assignment | Curves config; assignment read where available | T-MIX-01 |
| 64 | Base mixing in perceptual or linear space (cyan to violet to magenta) | Wrong | `P-64-violet` (`show-mixer/src/blend.test.ts`): midpoint of cyan and magenta has hue within violet range in OKLCH | Blend space DS-09 | T-MIX-02 |
| 65 | Exclusive impacts owned by one deck chosen by weight, master, confidence, strength, significance | Partial | `P-65-owner` (mixer test) plus `P-65-no-leak` (frame test: non-owner white hit does not change pixels) | Hysteresis config | T-MIX-03, T-MIX-06 |
| 66 | Transition-aware blackout translation | Wrong | `P-66-translate-all` (mixer test with planner-produced `ALL` blackout and other deck weight 0.8) | Translation policy DS-18 | T-MIX-04 |
| 67 | Incoming deck introduced palette and secondary spatial layer, then rhythm, then impacts | Partial | `P-67-introduction` (frame-sampled test across a fader ramp) | Layer tags drive stages | T-MIX-05 |
| 68 | Live audio layer: FFT, mel, AGC, rise/decay, onset, band energies, spectral difference; independent of LedFx code; subtle style-dependent overlay | Stub | `P-68-audio-dsp` (`reactive-audio/src/dsp.test.ts` with synthetic signals) | All concepts implemented; amount from style | T-AUD-02, T-AUD-03 |
| 69 | Allowed and forbidden live-audio modifications | Wrong risk | `P-69-no-relight` (overlay test): blacked-out cells stay black at maximum reactive input | Invariant in renderer | T-AUD-03 |
| 70 | FULL, STRUCTURED, ADAPTIVE levels; never silent; Live shows level | Wrong | `P-70-levels` (E2E): each level displayed with inputs listed | Readiness object drives UI | T-ANA-15, T-UI-02 |
| 71 | Adaptive director with state and phrase-length look library | Stub | `P-71-adaptive` (runtime test over 256 beats with no TrackModel): looks change only on phrase boundaries; cooldowns respected | Look library size and rules config | T-RUN-09 |

## Part G. Plan schema, rendering, persistence, repo standards (sections 72 to 87)

| Sec | Requirement | Now | Failing probe (Where) | Definition of done and metric | Tasks |
| --- | --- | --- | --- | --- | --- |
| 72 | ShowPlan with globalDesign, sections, cues, recurrence, constraints | Partial | `P-72-plan-schema` | v2 schema | T-PLAN-01 |
| 73 | Beat coordinates, fractional; seconds only at the boundary | Partial | `P-73-beat-domain` (ast-grep: no seconds fields in plan or cue types) | Branded types | T-RBL-03 |
| 74 | Efficient bidirectional mapping with binary search and piecewise interpolation, variable BPM | Partial (inverse is linear `find`, inconsistent extrapolation) | `P-74-mapping` (property test plus benchmark: 1 million mappings on a 2,000-beat grid under `contracts.mapping.benchMs`) | Both directions binary search; consistent edge policy | T-RBL-03 |
| 75 | Plans are venue independent | Partial | `P-75-no-device-refs` (ast-grep over plan types) | Rule in CI | T-PLAN-01 |
| 76 | Renderer responsibilities list | Partial | `P-76-pipeline` (renderer integration test through every stage) | All stages present | T-REND-01 to T-REND-05 |
| 77 | Spatial effects across devices in shared coordinates | Partial | `P-40` and `P-77-room-wave` (golden on owner room) | Goldens | T-ROOM-07, T-ROOM-12 |
| 78 | Simulated blinders with budget | Wrong (phrase blinder bypasses budget) | `P-78-blinder-budget` (planner test) | Budget config | T-PLAN-05, T-UI-04 |
| 79 | Simulated moving-light vocabulary: rise, fall, cross, fan, converge, diverge, chase, outside-in, inside-out, vertical scan, rotation around venue topology | Missing | `P-79-movement-vocabulary` (primitive registry test) | All present, including room rotation (Orbit) | T-ROOM-07, T-PLAN-04 |
| 80 | SQLite WAL with better-sqlite3 + Kysely; separate from Rekordbox | Wrong | `P-80-db-open` (integration: app opens DB in userData, WAL mode) | DS-06 | T-DATA-01 |
| 81 | 17 tables minimum | Partial (7) | `P-81-schema` (migration test lists tables) | All tables plus settings, jobs | T-DATA-02 |
| 82 | Artifacts carry schema, analyzer, planner versions and source fingerprint; selective invalidation | Wrong | `P-82-invalidation` (integration: bump planner version, TrackModel reused, plan regenerated) | Three invalidation paths tested | T-DATA-03, T-ANA-13 |
| 83 | Monorepo layout | Partial (no `electron/services/`, `src/app`, `routes`, `features`; no `protocol-fixtures/serato`, `govee`; no `test-fixtures/tracks`, `sessions`) | `P-83-layout` (layout test) | Layout matches spec plus new packages | T-ARC-05, T-TRU-02 |
| 84 | Strict TS, Zod, Yarn 4, pinned lockfile | OK | Regression | Keep | T-TRU-11 |
| 85 | uv only, `uv sync --frozen`, uv.lock | Partial (CI runs `uv run` without `--frozen`; ML group separate) | `P-85-frozen` (CI uses `uv sync --frozen --all-groups`) | CI and packaging use frozen installs | T-ANA-17, T-TRU-11 |
| 86 | Main, show worker, renderer, Python; frozen React never freezes output | Wrong | `P-56` | Architecture per 04 | T-ARC-01 |
| 87 | Typed, versioned, validated IPC; narrow preload; no Node in renderer | Partial | `P-87-ipc-contract` (every channel request and response validated; unknown channel impossible) | Typed API | T-ARC-02 |

## Part H. UI (sections 88 to 104)

| Sec | Requirement | Now | Failing probe (Where) | Definition of done and metric | Tasks |
| --- | --- | --- | --- | --- | --- |
| 88 | Professional performance look; 60 fps animations | Partial | `P-88-frame-time` (E2E perf trace on Live: p95 frame time under 16.7 ms) | Owner review screenshots | T-UI-01, T-UI-13 |
| 89 | Live layout with status bar, decks, master clock, dual waveform, venue preview, upcoming, emergency bar | Partial | `P-89-live-layout` (E2E asserts regions and live data) | Screenshot evidence | T-UI-02 |
| 90 | Deck card with 17 fields and a strong predictive field | Wrong | `P-90-drop-in-8` (E2E with SIM deck 8 beats before a drop shows "DROP IN 8") | All fields bound to live state | T-UI-02 |
| 91 | Waveform with grid, downbeats, sections, phrases, fills, events, hot cues, loops, playhead; semantic colour | Missing | `P-91-waveform` (component test with known model) | Canvas/WebGL component | T-UI-02 |
| 92 | Preview is the exact logical output; every cell real | Wrong | `P-92-snapshot-equals-output` (integration, M1: the snapshot the UI receives equals the frame handed to the recording transport, per cell, before calibration) and `P-92-preview-equals-output` (E2E, M4: preview pixel colours in the room view equal recording-transport frames before calibration) | Exact match at both levels | T-ARC-04, T-ROOM-10 |
| 93 | Upcoming meaningful cues with relative times | Wrong | `P-93-upcoming` (E2E) | Per-deck relative times | T-UI-02 |
| 94 | BLACKOUT, FULL WHITE, FREEZE, AUTO/MANUAL, MASTER always available; no modal; shortcuts | Wrong | `P-94-blackout-latency` (E2E + recording transport: keypress to UDP send p99 under 100 ms, target 20 ms) | Measured and logged | T-UI-03, T-RUN-07 |
| 95 | Library with playlists, crates, table, statuses | Wrong | `P-95-library` (E2E with fixture library) | Real rows | T-UI-05 |
| 96 | Track Inspector synchronized lanes and click-to-audition | Wrong | `P-96-inspector` (E2E: click beat 257, preview shows beat-257 frame) | Lanes rendered | T-UI-06 |
| 97 | Corrections with locked regeneration | Missing | `P-97-corrections` (E2E: move drop, lock section, regenerate, lock survives) | Persisted edits | T-UI-07, T-PLAN-11 |
| 98 | Interactive 2D room canvas | Missing | `P-98-venue-canvas` (E2E: draw room, place fixtures, persist) | Room editor | T-ROOM-03, T-UI-08 |
| 99 | Device screen fields and IDENTIFY, TEST CHASE, RECALIBRATE | Wrong | `P-99-device-actions` (E2E + SIM: each action produces the documented bytes) | Real metrics | T-GOV-12, T-UI-08 |
| 100 | 10-step setup | Wrong | `P-100-setup` (E2E fresh profile through all steps on SIM) | No step done without evidence | T-UI-09 |
| 101 | Diagnostics tabs (10) | Wrong | `P-101-diagnostics` (E2E: each tab shows live metrics) | Metrics real | T-UI-10, T-OPS-03 |
| 102 | DJ Event Inspector with raw and normalized, latency; ndjson recording | Missing | `P-102-event-inspector` (E2E) | Recording file replays | T-UI-10, T-DATA-06 |
| 103 | Session recorder replays exactly into simulator | Missing | `P-103-replay-exact` (integration: record 10 min SIM session, replay, frame hashes identical) | 100% hash equality | T-DATA-06 |
| 104 | Simulator for Rekordbox, Serato, FLX4, Govee, latency, loss, disconnects | Partial | `P-104-sim-suite` (simulators pass their own contract tests) | All simulators on real sockets or ports | T-GOV-14, T-QA-04 |

## Part I. Reliability, security, quality (sections 105 to 131)

| Sec | Requirement | Now | Failing probe (Where) | Definition of done and metric | Tasks |
| --- | --- | --- | --- | --- | --- |
| 105 | DJ source loss: 0 to 500 ms extrapolate, 500 ms to 2 s hold, then degraded; never all-off on one miss | Stub | `P-105-source-loss` (runtime fault test) | Thresholds config; frames never all black from loss alone | T-RUN-06 |
| 106 | Device loss: others continue; reconnect, re-arm, current frame; no stale replay | Wrong | `P-106-device-loss` (SIM: kill device 2 of 3; others unaffected; restart; current frame within `govee.lan.reconnect.maxMs`) | Measured | T-GOV-06, T-GOV-08 |
| 107 | Congestion: monitor requested, sent, superseded, RTT; reduce only affected device FPS; logical 60 Hz | Wrong | `P-107-congestion` (SIM with throttled device) | Metrics and backoff | T-GOV-08, T-GOV-19 |
| 108 | Renderer reload leaves show running | Wrong | `P-108-reload` (E2E: reload window during show; recording transport gap 0 frames) | Measured | T-ARC-04 |
| 109 | Analysis crash: show unaffected, job retried | Wrong | `P-14` | Measured | T-ANA-02 |
| 110 | Local-first, read-only libraries and audio, secrets in safeStorage, no external control server | Partial | `P-110-security` (integration: API key round trip through safeStorage; port scan shows no listener on non-loopback except Govee UDP) | Security checklist | T-SEC-01 to T-SEC-04 |
| 111 | Govee network hygiene and trust status | Missing | `P-111-trust` (E2E diagnostics tab) | Visible | T-GOV-16 |
| 112 | Licensing rules | Partial | `P-112-license-audit` (CI license checker over yarn and uv dependencies; GPL denylist) | THIRD_PARTY_NOTICES generated | T-DOC-04, T-TRU-10 |
| 113 | Planner permits learned scoring without requiring it | Missing | `P-113-scoring-hook` (planner test with a dummy evaluator) | DS-19 | T-PLAN-12 |
| 114 | ShowPlan invariants | Stub | `P-114-invariants` (validator runs on every compile; each listed invariant has a failing example) | All listed invariants | T-PLAN-10 |
| 115 | 10 automatic diagnostics | Stub | `P-115-diagnostics` (planner test) | All 10 from sampled frames | T-PLAN-10 |
| 116 | Curated validation set across 13 categories | Missing | `P-116-validation-set` (manifest lint: every category has at least `qa.validation.minPerCategory` tracks) | Owner-supplied list plus review | T-QA-09 |
| 117 | 60 Hz logical renderer; jitter p99 under 5 ms; bounded DJ queues; UI 60 fps | Missing | `P-117-perf` (performance harness) | Measured on reference Mac and Windows | T-QA-05 |
| 118 | No output queue growth, no stale frames, no cloud; p95 visible impact within 50 ms; blackout request to send under 100 ms | Missing | `P-118-physical` (HW camera runbook) plus `P-94` | Measured | T-QA-08 |
| 119 | Track-sync qualification matrix (20 manipulations) | Missing | `P-119-sync-matrix` (SIM per provider; HW runbook) | All rows pass per provider that claims them | T-QA-07 |
| 120 | Rekordbox DoD (18 items) | Missing | `P-120-rekordbox-dod` (checklist test aggregating probes) | All 18 on macOS and Windows | T-LIVE-*, T-QA-11 |
| 121 | Serato DoD (16 items) | Missing | `P-121-serato-dod` | All 16 | T-SER-06 |
| 122 | H6076 DoD (13 items, two units) | Missing | `P-122-h6076-dod` (HW) | All | T-QA-08 |
| 123 | H1A45 DoD (10 items) | Missing | `P-123-h1a45-dod` (HW) | All | T-QA-08 |
| 124 | Multi-device DoD (10 demonstrations) | Missing | `P-124-multi-dod` (HW + SIM) | All | T-QA-08 |
| 125 | Four-hour soak with seven pass conditions | Wrong | `P-125-soak` (nightly SIM wall-clock soak; HW runbook) | Trend thresholds in T-QA-06 | T-QA-06 |
| 126 | Vitest, pytest, Playwright; 12 test classes | Partial | `P-126-classes` (CI job fails if any class has zero tests) | All classes present | T-QA-01 |
| 127 | Golden renderer tests | Partial | `P-127-goldens` | Per primitive and venue | T-REND-06, T-QA-10 |
| 128 | Protocol replay of real captures at 1x, 2x, 10x, step | Wrong | `P-128-replay-decodes` | Raw to decoder to DeckState | T-QA-03 |
| 129 | Planner regression with deliberate golden updates | Wrong (self-write) | `P-129-no-self-write` | Update only via `yarn golden:update` with reason file | T-PLAN-15, T-TRU-15 |
| 130 | Structured logs with 10 fields; no raw spam outside diagnostic mode | Stub | `P-130-log-schema` | Log files validated | T-OPS-02 |
| 131 | 12 local metrics read directly by Diagnostics | Stub | `P-131-metrics` | All 12 measured | T-OPS-03 |

## Part J. Workflows and policies (sections 132 to 151)

| Sec | Requirement | Now | Failing probe (Where) | Definition of done and metric | Tasks |
| --- | --- | --- | --- | --- | --- |
| 132 | 11-stage startup | Stub | `P-132-startup` (E2E: stages reported in order with timings) | Startup state machine | T-ARC-03 |
| 133 | 9-step graceful shutdown; safe-state crash policy | Missing | `P-133-shutdown` (E2E + recording transport: ending look sent, streams disarmed, DB flushed) | Measured | T-ARC-03, T-OPS-07 |
| 134 | Manual override controls and quantized resume (default next bar) | Wrong | `P-134-override` (runtime test for each control and resume mode) | All modes | T-RUN-07 |
| 135 | ShowStyle with 11 properties; 7 polished built-ins; good default | Partial | `P-135-styles` (schema and diagnostics per style differ in the expected direction) | Style editor | T-PLAN-09, T-UI-14 |
| 136 | Rekordbox recommended when both installed; status bar says REKORDBOX or SERATO; no generic "audio source" | Partial | `P-136-rekordbox-first` (E2E setup with both detected) | Detection and copy | T-UI-09 |
| 137 | Readiness FULL, STRUCTURED, ADAPTIVE with explanation of inputs | Wrong | `P-137-readiness` (E2E click explains) | Readiness object | T-ANA-15, T-UI-05 |
| 138 | Track load fast path; no ML on critical path | Stub | `P-138-fast-path` (integration: load event to installed plan p95 under `runtime.fastPath.budgetMs`, default 100 ms) | Measured | T-RUN-08 |
| 139 | Library preanalysis queue with 5 states; artifacts persist | Missing | `P-139-queue` (E2E) | Persisted queue | T-ANA-02, T-UI-05 |
| 140 | Best available level immediately; upgrade only at clean phrase boundary | Missing | `P-140-upgrade-boundary` (runtime test) | Boundary rule | T-RUN-08 |
| 141 | Watch Rekordbox DB, Serato DB/crates, audio mtime/hash, ANLZ mtime; selective invalidation | Missing | `P-141-watch` (integration with temp files) | Watcher | T-RBL-06, T-SER-04 |
| 142 | Component library of 14 components; no page-specific copies | Missing | `P-142-components` (component tests, duplication check) | All 14 | T-UI-01 |
| 143 | Readable at several feet, large targets, shortcuts, contrast, labels, not colour-only | Partial | `P-143-a11y` (axe-core in E2E; target size rules; owner distance review) | WCAG AA contrast; 44 px targets for critical controls | T-UI-12 |
| 144 | No surprise modal during Live; emergency controls remain active | Partial | `P-144-no-modal` (E2E: inject analysis failure, device loss and an update notice during Live; no dialog appears; B, W, F, A still act within the `P-94` bound; no confirmation dialog for any Live action) | Enforced by a modal guard | T-UI-12 |
| 145 | No updates during performance; locked deps; UNVERIFIED REKORDBOX VERSION | Missing | `P-145-unverified-banner` (E2E with version 9.9.9 simulated) | Banner and policy | T-OPS-04, T-LIVE-13 |
| 146 | Version-aware protocol definitions with fixture sets | Stub | `P-146-registry` | Registry | T-LIVE-13 |
| 147 | Unknown firmware: normal control continues, background checks, warning, no spamming failing stream | Missing | `P-147-unknown-fw` (SIM with unknown firmware string) | Policy | T-GOV-17 |
| 148 | LAN segmented, then BLE segmented if verified, then whole-fixture LAN; cloud never for frames | Wrong | `P-148-ladder` (SIM: block LAN, BLE takes over segments; block both, whole-fixture) | DS-03 | T-FOV-01, T-FOV-02 |
| 149 | Show loop owns desired state; transport owns delivery and may skip | Wrong | `P-51` | Architecture | T-ARC-01, T-GOV-08 |
| 150 | Normal night user flow | Missing | `P-1-normal-night` (`apps/desktop/e2e/normal-night.spec.ts`) | All 17 rows of `99-final-acceptance.md` section 3 on SIM nightly and on HW (`HW-NIGHT-01`) | T-QA-11 (every task contributes) |
| 151 | Viewer can infer breakdown, build, imminent event, drop, returning chorus, incoming track | Missing | `P-151-review` (owner review protocol on rendered videos, T-QA-13) | Owner sign-off | T-QA-13 |

## Part K. Gates, definition of done, build order, boundary (sections 152 to 155)

| Sec | Requirement | Now | Failing probe | Definition of done | Tasks |
| --- | --- | --- | --- | --- | --- |
| 152 A | Rekordbox and Serato acceptance suites pass | Fail | `P-120`, `P-121` | Both | T-QA-11 |
| 152 B | Native plus ML analysis produces valid TrackModels | Fail | `P-20`, `P-22` | Validation set | T-QA-11 |
| 152 C | H6076 and H1A45 segmented local rendering | Fail | `P-122`, `P-123` | HW | T-QA-11 |
| 152 D | Reference tracks produce coherent deterministic scores | Fail | `P-116`, `P-129` | Owner review | T-QA-11 |
| 152 E | Loops, seeks, pitch, two-deck mixing | Fail | `P-119` | SIM and HW | T-QA-11 |
| 152 F | Primary workflows without developer tools | Fail | E2E suite | Packaged app | T-QA-11 |
| 152 G | Four-hour soak | Fail | `P-125` | Nightly and HW | T-QA-11 |
| 152 H | Fresh-machine install on macOS and Windows | Fail | `P-153-clean-install` | VM matrix | T-OPS-06 |
| 153 | Hard definition of done | Fail | `99-final-acceptance.md` | All | All |
| 154 | Build order phases 1 to 10, no reduced MVP | Not followed | This plan's milestones follow the spirit (hardware and live acquisition early) | Milestones M0 to M6 | README |
| 155 | Final architectural boundary diagram | Partial | `P-155-boundaries` (dependency-cruiser rules encode every arrow) | Rules in CI | T-TRU-04, T-ARC-05 |
