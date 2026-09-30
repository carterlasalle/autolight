# WP12. Show runtime, two-deck mixer, renderer and live audio

Spec sections: 33, 40, 49, 55 to 71, 76, 77, 92 (output equality), 105 to 108,
117, 118, 134, 138, 140, 149. Findings closed: F-RUN-01 to F-RUN-10, F-MIX-01
to F-MIX-08, F-REND-01 to F-REND-08, F-REND-10, F-REND-11, F-AUD-01 to
F-AUD-05, F-APP-02, F-APP-04, F-APP-07, F-APP-09, F-APP-11, F-APP-19,
F-APP-20, F-GOV-16 (master path), F-QA-09, F-UI-05 (data part).

All of this runs in the show host (`04-target-architecture.md`, `T-ARC-01`),
never in React. The renderer process only receives snapshots.

## 0. What went wrong last time, specifically

- The "show loop" was a 250 ms React interval; the estimator formula existed
  but `predicted = prevBeat + 0`, and `isSeek` was called with beats as
  seconds.
- Cells composited with `Math.max`, so darkness could never override light
  (28 of 28 cells stayed lit under a partial blackout).
- The crossfader multiplied into every deck, so at crossfader 0 both decks
  were silent; the Live view bypassed `mixDown`, so a non-owner's white hit
  still changed pixels.
- Live audio added gain to zero channels (relighting darkness) and shifted
  hue; the "wired" overlay was hard-coded to zero.

## 1. Tasks: show runtime (T-RUN)

### T-RUN-01 Deck worlds in the show host

- Closes: F-APP-02 (with `T-ARC-01`, `T-ARC-04`); probes `P-56-ui-freeze`,
  `P-62-two-worlds`.
- Up to four deck worlds (spec 62 with four-deck sources), each holding the
  installed TrackModel, ShowPlan, cursor, estimator, loop and scratch state
  and a generation token. DeckState arrives on a latest-wins port per deck;
  the tick reads the newest state and never blocks.
- The tick order is fixed and documented: ingest, estimate, per-deck
  evaluation, director, mixer, overrides, render, output handoff, metrics,
  snapshot (at `runtime.snapshot.uiRateHz`).
- DoD: `P-56` (renderer paused 5 s: recording transport receives frames at
  the logical rate, tick jitter p99 under 5 ms, measured by `T-ARC-06`
  harness); `P-62` (two decks evaluated independently, one mixer).

### T-RUN-02 State estimator with smooth correction

- Closes: F-RUN-01, F-APP-09; probe `P-57-estimator`.
- `estimated = P + (now - T) * R` while playing (spec 57), in `Seconds` from
  the observation, converted to `Beat` through the grid (`T-RBL-03`). Small
  errors are corrected by a slew-limited phase correction
  (`runtime.estimator.correctionGain`, `maxSlewBeatsPerSec`) so the beat
  never steps backwards while playing; large errors become transport events
  (seek, `T-RUN-03`).
- Observation quality weights the correction (an `exact` rkbx-osc time
  corrects faster than an `estimated` AX time).
- Remove the renderer cursor math entirely (the 0.1 factor, the 0.02 deck B
  increment, the first-beat BPM).
- DoD: `P-57` property tests: noisy 30 Hz observations with jitter and loss
  give error below `runtime.estimator.maxErrorMs` and zero backward steps;
  pitch changes of plus or minus 8 and 16 percent tracked within the bound.

### T-RUN-03 Seek as random access

- Closes: F-RUN-01; probe `P-58-seek`.
- On SEEK (observed minus predicted beyond `runtime.seek.thresholdBeats` or
  `thresholdMs`, or an explicit provider event): reset the interpolator,
  recompute the fractional beat, reconstruct plan state at that beat as a pure
  function of the plan (spec 58, "random-access state functions"), cancel
  transients from the abandoned location, and output the new state in the
  same tick. No replay of prior cues.
- Paused seeks (hot cue while paused) reconstruct state and hold it, they do
  not freeze the old state.
- DoD: `P-58` (hot cue from 300 to 64 renders the beat-64 state within one
  tick and drops the in-flight white hit); a property test: rendering at beat
  b after any seek history equals rendering at b from a fresh cursor, for
  every cue type.

### T-RUN-04 Loops and rolls

- Closes: F-RUN-02; probes `P-59-loop`, `P-60-roll-degrade`.
- `DeckState.loop` and `loopRoll` are consumed: the cursor evaluates the loop
  region repeatedly; transient state is loop-aware (a hit at the loop start
  fires each pass, not once); pass variation follows `runtime.loop.variation`
  deterministically.
- Tiny loops and rolls (1/2 to 1/16): check each fixture's qualified rate; if
  a fixture cannot show the sub-beat toggling accurately, degrade that fixture
  in the order `runtime.roll.degradeOrder` (brightness pulse, spatial
  contraction, single impact) instead of irregular strobing (spec 60).
- DoD: `P-59` (A, B, A variation visible in frame hashes across passes, while
  the section's visual identity is preserved: the same palette references and
  motif ID on every pass, spec 59);
  `P-60` with a 20 Hz fixture and a 1/16 roll produces the degrade choice, and
  a 60 Hz simulated fixture gets the full roll.

### T-RUN-05 Reverse and scratch

- Closes: F-RUN-03; probe `P-61-scratch`.
- Negative play rate follows the source backward (spec 61). Scratch
  (detected from rate deviation and reversals, `runtime.scratch.*`, plus FLX4
  jog hints when no stronger source exists) enters SCRATCH HOLD: keep the
  current base look, allow limited beat and gesture modulation, and resync at
  the next `runtime.scratch.resyncAt` boundary once forward playback is
  stable. Reverse playback without scratch (a reverse effect) follows the
  timeline.
- DoD: `P-61` with a recorded jog trace: hold during scratch, resync at the
  boundary, no whole-design jumps; reverse test follows backward.

### T-RUN-06 Source loss, device faults and the adaptive clock

- Closes: F-RUN-05, F-RUN-10; probe `P-105-source-loss`.
- Clock health per deck from state age: `live` below
  `runtime.health.extrapolateMs` (extrapolate), `holding` up to
  `runtime.health.holdMs` (hold the estimate, fade motion), then `degraded`
  (switch to the adaptive clock DS-23: `dj-bpm` last known BPM and phase,
  `audio-onset` live tempo from `T-AUD-02`, `blend` default). Never all-off
  on one missed message (spec 105). Health is shown in the status bar.
- Device faults are handled in the govee-manager (`T-GOV-06`, `T-GOV-08`); the
  runtime receives per-device effective capability and FPS and keeps the
  logical 60 Hz for everyone else (spec 107).
- DoD: `P-105` fault tests (drop the provider for 300 ms, 1.5 s, 10 s);
  frames never go all black from loss alone; the adaptive clock's beat error
  measured after loss.

### T-RUN-07 Manual overrides and emergency path

- Closes: F-RUN-04, F-RUN-07, F-APP-04 (runtime part), F-APP-19,
  F-GOV-16; probes `P-134-override`, `P-94-blackout-latency`,
  `P-50-no-beat-brightness`.
- State machine per spec 134: BLACKOUT, WHITE (RGB white at
  `runtime.override.whiteIntensity`, never kelvin), FREEZE (hold the last
  rendered look, continue the clock), master intensity (applied in the
  renderer's last layer every frame, and mirrored to the device's global
  brightness only through the slow path limited by
  `govee.brightness.maxPerMinute`), force low-energy look, force high-energy
  look, resume automation with `next beat`, `next bar` (default), `next
  phrase`, `immediate` (really immediate, not rounded up). Bars and phrases
  come from the native grid and PSSI or fused phrases, not multiples of 4 and
  16.
- Emergency intents bypass every queue: the IPC router forwards
  `master.blackout` and `master.white` to the show host on a dedicated port,
  and the show host renders and hands the frame to the transport in the same
  tick it receives the intent (target keypress to UDP send p99 under 20 ms,
  hard limit 100 ms, spec 118).
- The manual lane's controls (palette, flash on beat, alternating A and B,
  manual tier, sensitivity, swatches, white hold, target) are real intents
  with runtime effects (or are removed from Live if they conflict with spec
  88; see `T-UI-04`).
- DoD: `P-134` for every control and every resume mode; `P-94` measured in
  E2E with the recording transport (evidence JSON with p50, p95, p99);
  `P-50` counts brightness commands over 60 s of show.

### T-RUN-08 Track load fast path, prepared-show upgrade and style handover

- Closes: F-APP-03, F-APP-11, F-RUN-08, F-RUN-09; probes `P-138-fast-path`,
  `P-140-upgrade-boundary`.
- On a new generation: resolve identity (`T-RBL-07`), fetch the cached
  TrackModel and ShowPlan (`T-DATA-04`), install into the deck world, update
  the UI (spec 138). No ML on this path. If the plan is missing but a model
  exists, compile in the planner worker and install; if nothing exists, run
  the best available level now (STRUCTURED from native data, or ADAPTIVE)
  and queue analysis at top priority.
- Upgrades (a better plan arriving while the track plays, a style change, a
  planner edit) install only at a clean boundary (`runtime.upgrade.boundary`,
  default phrase) with a crossfade of looks (spec 140).
- `loadFastPath` returns parsed objects, not a path string.
- DoD: `P-138` (load event to installed plan p95 under
  `runtime.fastPath.budgetMs` with a warm cache); `P-140` (upgrade lands on a
  phrase boundary, never mid-phrase during audible playback); style switch
  test.

### T-RUN-09 Adaptive director

- Closes: F-RUN-06; probe `P-71-adaptive`.
- State per spec 71: current energy state, estimated phrase counter, recent
  motif history, palette, recent effects, cooldowns, darkness state, spatial
  direction. A library of coherent phrase-length looks (built from the same
  primitive registry, parameterized by energy and style, at least
  `runtime.adaptive.minLooks` looks) chosen on phrase boundaries with
  cooldowns (`runtime.adaptive.cooldownPhrases`) and the runtime restraint
  engine.
- DS-28: `rules` (phrase look library), `audio-informed` (energy and onset
  from `T-AUD-02` pick energy levels and accents), `combined` (default).
- Consumes FLX4 hints (`T-FLX-05`) as director inputs.
- DoD: `P-71` over 256 beats with no TrackModel: looks change only on phrase
  boundaries, cooldowns respected, no two consecutive identical looks; owner
  review video of 5 minutes of an unanalyzed track.

## 2. Tasks: show mixer (T-MIX)

### T-MIX-01 Audible weight

- Closes: F-MIX-01, F-MIX-08; probe `P-63-crossfader`.
- Weight per deck from channel fader, crossfader position through assignment
  (`mixer.crossfader.assignment`, A, B or THRU per deck) and curve
  (`mixer.crossfader.curve`, with DS-26 choosing where the curve and position
  come from: DJ software, the FLX4, or configured), playing state, and master
  status (`mixer.weight.masterBonus`). FLX4 values confirm or fill in (spec
  63).
- DoD: `P-63` (hard left: A 1, B 0; hard right: A 0, B 1; centre per curve;
  THRU ignores the crossfader); property test over random fader states.

### T-MIX-02 Base mixing in perceptual and linear space

- Closes: F-MIX-02, F-MIX-05, F-PLAN-13; probe `P-64-violet`.
- Base layers blend in the space chosen by `mixer.blendSpace` (DS-09:
  `oklab`, `linear-rgb`, `srgb-legacy` for comparison, and the combined
  `oklab-hue-linear-intensity`). Weights are not normalized to 1: a lone quiet
  deck produces a proportionally quiet look.
- One shared colour module (OKLab, OKLCH, linear RGB, sRGB transfer) used by
  planner, mixer and renderer; property tests for round trips.
- DoD: `P-64` (cyan to magenta midpoint is violet in OKLCH); lone-deck test
  at weight 0.3 gives a look at the expected intensity; Inspector A/B view
  of blend spaces (`T-UI-06`).

### T-MIX-03 Exclusive impact ownership

- Closes: F-MIX-07; probes `P-65-owner`, `P-65-no-leak`.
- Blackout, strobe, white hit and full-room impact are exclusive resources.
  The owner is chosen by a weighted score of audible weight, master status,
  event confidence, event strength and structural significance
  (`mixer.owner.factorWeights`) with hysteresis (`mixer.owner.hysteresis`).
  The non-owner's exclusive cue is translated (T-MIX-04) or dropped with a
  recorded reason.
- DoD: `P-65` tests; ownership changes are visible in the DJ Event
  Inspector.

### T-MIX-04 Transition-aware blackout translation

- Closes: F-MIX-03, F-QA-09; probe `P-66-translate-all`.
- When a deck's blackout (including the planner's `ALL` target) happens while
  another deck is audible above `mixer.blackout.otherDeckThreshold`, translate
  per DS-18: `full` (keep), `deck-spatial-dip`, `deck-side-blackout` (the
  deck's side of the room from WP05 splits), `global-partial-dip`; `auto`
  keeps full only when both tracks structurally support it (both at a
  pre-drop or both at a section end), else chooses by the other deck's weight.
- Tests use inputs produced by the real planner (S11); the old `SIDE`
  target test is deleted.
- DoD: `P-66` with a planner-produced `ALL` blackout and the other deck at
  0.8; each DS-18 mode has a test.

### T-MIX-05 Incoming deck introduction by layer

- Closes: F-MIX-06; probe `P-67-introduction`.
- As the incoming weight crosses `mixer.intro.paletteAt`, `rhythmAt` and
  `impactsAt`, admit its palette and secondary spatial layer, then its rhythm
  layers, then its exclusive impacts, using the layer tags from
  `T-PLAN-13` (no priority heuristics).
- DoD: `P-67` frame-sampled across a fader ramp shows the three stages in
  order.

### T-MIX-06 One path to pixels

- Closes: F-MIX-04, F-MIX-05, F-APP-07, F-UI-05 (data); probes
  `P-62-two-worlds`, `P-65-no-leak`.
- The only way a cue reaches a frame is through the mixer and the renderer in
  the show host. The UI's "upcoming cues" come from the show host snapshot,
  computed per deck with that deck's own beat and real cue durations,
  intensities and priorities.
- DoD: dependency-cruiser rule (renderer UI cannot import mixer or renderer);
  a test with a non-owner white hit proves no pixel changes; upcoming cues
  test for two decks at different beats.

## 3. Tasks: renderer (T-REND)

### T-REND-01 Eight-layer stack with real compositing

- Closes: F-REND-01, F-REND-08; probes `P-2.5-partial-darkness`,
  `P-33-layer-stack`.
- Layers in spec 33 order: base look, spatial motion, beat modulation,
  musical accents, exclusive impact effects, live reactive overlay, manual
  override, master intensity. Each layer contributes per cell a colour, an
  alpha and a blend mode (`replace`, `over`, `multiply` for dips and
  darkness, `add` with ceiling, `max` only where a primitive asks for it).
  Darkness is a first-class contribution (a blackout layer replaces with
  black at its alpha).
- DoD: `P-2.5` (LEFT blackout over an ALL look darkens exactly the LEFT
  cells); `P-33` (manual override beats exclusive impact beats accents;
  master scales last); golden frames for each blend mode.

### T-REND-02 Primitive renderers with envelopes

- Closes: F-REND-02 (and the renderer half of F-PLAN-03).
- One render function per registered primitive (`T-PLAN-04`, WP05), pure
  over cell fields, local beat and parameters, with attack and release
  envelopes given as `EnvelopeTime` (`T-RBL-03`): beats, or milliseconds for
  cases like spec 36's 90 ms impact, which the renderer converts through the
  deck's current tempo every frame (so a pitch change keeps 90 ms at 90 ms).
  No other cue field carries time units other than beats. White hit and
  impact render on the exclusive layer with their own envelopes, not as chase
  phases.
- DoD: per-primitive unit tests and goldens; an `ALL` white hit on top of a
  partial blackout follows layer precedence.

### T-REND-03 Colour pipeline and per-fixture calibration

- Closes: F-REND-03, F-REND-06, F-REND-11, F-PLAN-01 (renderer half),
  F-VEN-05 (renderer half); probes `P-29-no-timer-colour`,
  `P-49-linear-light`.
- Colours come only from the plan's palette references (OKLCH) through the
  shared colour module: OKLCH to OKLab to linear RGB; intensity applied in
  linear light to arbitrary colours; then per fixture: white balance matrix,
  brightness ceiling, per-device gamma (from calibration, default
  `render.gammaDefault`), orientation and cell order, then sRGB bytes at the
  transport boundary only (spec 49, 76).
- Delete the hue-from-start-beat code and the hardcoded 0.75 to 1.0 shape.
- DoD: `P-49` ((255, 0, 90) at 0.30 equals the linear-light expected bytes);
  calibration test: a fixture with a measured gamma and ceiling produces the
  expected bytes; reversed orientation reverses cells.

### T-REND-04 Global latency compensation

- Closes: F-REND-04; probe `P-55-latency-global`.
- Per fixture latency (DS-17: `measured` from qualification, `sku-default`,
  combined `measured-else-sku` with an "unmeasured" badge) is converted to a
  beat offset through the deck's current tempo; the renderer evaluates the
  whole venue at the compensated beat and samples that fixture's cells, so
  spatial fields and global ordering never change.
- DoD: `P-55` (zero latency equals the plain render bit for bit; 50 ms shifts
  the sample beat by the tempo-correct amount without changing spatial
  continuity); on SIM with simulated per-device latencies of 20, 60 and 120
  ms, the simulator's rendered zone onsets for a white hit coincide within
  one tick. The physical spread (p95 within 50 ms on camera) is measured
  and owned by `T-QA-08`.

### T-REND-05 Physical regions, dense arrays, correct addressing

- Closes: F-REND-05, F-REND-07, F-REND-10; probes `P-40-cross-device-chase`,
  `P-41-derived-groups`.
- Groups and selectors resolve to cell index sets from WP05 fields (LEFT is
  DJ-relative physical left, not a population third). Selector resolution is
  cached per venue version. Frames are typed arrays indexed by physical index
  per fixture (`T-ROOM-02`), written through the logical to physical table;
  the UI reads frames by cell ID, not array position. No `find` or string
  keys per cell per frame.
- DoD: `P-40`, `P-41`; sparse index test; allocation profile shows no
  per-frame allocation in steady state.

### T-REND-06 Renderer goldens

- Closes: spec 127; probe `P-127-goldens`.
- Given ShowPlan, beat and VenueModel, the exact logical frame is hashed
  (spec 127). Goldens per primitive, per blend mode, per reference room
  (WP05), and for the spec 36 drop sequence at its key beats, with PNG renders
  for review. Updated only through `yarn golden:update --reason`.
- DoD: goldens committed; a one-line change in a primitive fails the suite.

### T-REND-07 Renderer performance

- Closes: spec 117 (renderer part).
- Budget: one tick's evaluate plus mix plus render for 2,000 cells and two
  decks under `render.tickBudgetMs` on the reference Mac and Windows machine,
  measured by the harness (`T-QA-05`); zero steady-state allocations.
- DoD: benchmark JSON in evidence on both machines.

## 4. Tasks: live audio (T-AUD)

### T-AUD-01 Capture host outside React (DS-14)

- Closes: F-AUD-03, F-AUD-05, F-APP-20 (capture part).
- `audio-window` (default): a hidden window whose only job is capture and
  DSP, created by main, surviving UI reloads, streaming features to the show
  host over a MessagePort (bounded, latest wins); `renderer` mode kept for
  comparison; combined `audio-window-with-renderer-fallback`.
- Device selection uses `audio.capture.deviceId` (the constraint is applied,
  not ignored); permission states are real (granted, denied, not requested);
  start and stop are idempotent (no leaked AudioContexts or loops); a
  loopback device is recommended in Setup for capturing the DJ output.
- DoD: E2E: reload the UI during capture, features keep arriving; start
  twice, one context; device switch test.

### T-AUD-02 Independent DSP

- Closes: F-AUD-01; probe `P-68-audio-dsp`.
- FFT (`audio.fftSize`), mel banks (`audio.melBands`), AGC
  (`audio.agc.*`), rise and decay smoothing, onset detection (spectral flux
  with adaptive threshold `audio.onset.threshold`), band energies, spectral
  difference, and a live tempo estimate for DS-23. Written from the concepts
  (spec 68); no LedFx code (GPL-3.0).
- DoD: tests with synthetic signals (sine sweeps, click trains, noise
  bursts): onsets within one hop, band energies correct, AGC converges.

### T-AUD-03 Overlay rules

- Closes: F-AUD-02, F-AUD-04, F-APP-20; probe `P-69-no-relight`.
- The overlay may only modify what spec 69 allows (pulse envelope, small
  brightness bump, sparkle density, minor segment displacement, decay rate,
  micro accents) and only scales light that the planned layers produced:
  a black cell stays black; hue is preserved (brightness scales all channels
  in linear light together). Amount is `audio.overlay.cap` times
  `style.reactiveAmount`. The overlay can never change section, declare a
  drop, replace the palette, strobe or discard the show.
- DoD: `P-69` at maximum reactive input; hue preservation property test;
  style dependence test.

### T-AUD-04 Audio timing alignment

- Closes: supports F-LIVE-06 (composite correction) and DS-23.
- Measure the capture path latency (output a test click through the chosen
  output and capture it, or use a known onset in a reference track) and
  record it; timestamp features in show clock time with that offset, so the
  composite provider's correlation (`T-LIVE-07`) and the adaptive clock use
  aligned data.
- DoD: latency measurement procedure in the runbook; aligned-feature test
  with a synthetic delay.

## 5. Config keys added (added to `03` sections 3.1 and 3.2)

`runtime.adaptive.minLooks` (24), `render.tickBudgetMs` (4). Unmeasured
targets.
