# WP11. Show planner

Spec sections: 2.1, 2.4 to 2.6, 26 to 37, 72, 73, 75, 78, 79, 113 to 115, 129,
135. Findings closed: F-PLAN-01 to F-PLAN-18, F-APP-12, F-APP-18 (planner
part).

## 0. What went wrong last time, specifically

- `planShow` computed the track's identity and then threw it away
  (`void identity`); the renderer invented hues from cue start beats, giving
  15 hues for 15 sections on a real track.
- About 7 of 27 primitives existed, as free strings with no parameters; the
  "hierarchy" was a section look plus a fixed 8-beat chase flip; recurrence
  was occurrence parity; the restraint engine was one cooldown with a
  "ponytail" comment; no strobe was ever generated; the golden test wrote
  itself when missing.

The planner is the lighting designer. Its output must look designed on a
real track, and every rule the spec lists must be implemented, tested and
visible in diagnostics.

## 1. Inputs, outputs and boundaries

```ts
planShow(input: {
  track: TrackModelV2;              // WP10
  venue: VenueCapabilityClass;      // derived from the venue (WP05): topology classes present, fixture counts per role, min fps, capability flags
  style: ShowStyle;                 // spec 135, all 11 properties
  edits?: PlanEdits;                // locks and user corrections (T-PLAN-11)
  config: PlannerConfigSnapshot;    // planner.* keys, frozen for this compile
}): { plan: ShowPlanV2; diagnostics: PlanDiagnostics; rejected: RejectedCandidate[] }
```

- The planner never sends frames and never references device IDs (spec 26,
  75); dependency-cruiser forbids imports of `govee`, `venue` device internals
  and `renderer`.
- Seed: from the track fingerprint (`T-ID-02`); determinism inputs are track
  fingerprint, planner version, style hash, venue capability class hash and
  config snapshot hash (spec 27). The plan records all five.
- Compilation runs off the show thread (main-process worker thread
  `planner-worker`), so compile time never affects output timing.

## 2. Tasks

### T-PLAN-01 ShowPlan v2, typed cues and spatial selectors

- Closes: F-PLAN-02, F-PLAN-16, F-PLAN-18, F-PLAN-01 (identity use); probes
  `P-26-planner-inputs`, `P-27-seed-fingerprint`, `P-32-typed-cues`,
  `P-72-plan-schema`, `P-75-no-device-refs`.
- `ShowPlanV2`: the spec 72 fields by their spec names (`schemaVersion`,
  `plannerVersion`, `trackId`, `styleId`, `seed`), plus `determinism` (the
  five inputs and their hashes), `globalDesign`
  (T-PLAN-02), `sections` (per section: look, palette refs, movement family,
  brightness range, density, darkness, participating groups), `cues` (a
  discriminated union over every registered primitive type with typed
  parameters, stable `id`, `level` (track, section, phrase, bar, beat,
  sub-beat), `layer` (the eight spec 33 layers), `startBeat`, `durationBeats`,
  `intensity`, `attack`, `release`, `priority`, `target: SpatialSelector`,
  colour as palette references resolved to OKLCH, `reason` (why the planner
  chose it, for the Inspector)), `recurrence` (MotifMap, T-PLAN-08) and
  `constraints` (budgets used and remaining).
- `SpatialSelector`: groups, split parts, zones, anchors, field predicates
  (WP05 section 4), combinators (union, intersection, difference); never
  device IDs.
- All positions in `Beat` (spec 73); no seconds or milliseconds fields in plan
  types (ast-grep rule, `T-RBL-03`). Attack, release and impact durations use
  the one allowed `EnvelopeTime` type (beats, or milliseconds for spec 36's
  90 ms impact), converted by the renderer through the current tempo.
- DoD: schema tests; determinism test (same five inputs, byte-identical plan;
  change any one, different plan); ast-grep rule for device IDs in plan types.

### T-PLAN-02 Whole-song identity and colour story

- Closes: F-PLAN-01, F-PLAN-13; probes `P-28-global-design`,
  `P-29-no-timer-colour`.
- Before any cue, choose and record in `globalDesign`: primary palette (2 to 3
  core colours), secondary palette, neutral accent (white or a neutral for
  impacts), spatial motif (origin, direction, heads, from WP05 primitives),
  movement vocabulary (the primitive families this track uses), density
  baseline, contrast baseline, impact budget, darkness budget (spec 28).
- Palettes are chosen in OKLCH from track features (energy distribution,
  key and mode from `T-ANA-18`, spectral centroid profile, genre hints from
  metadata when present, the style's saturation), seeded deterministically;
  colour distance rules keep core colours distinguishable on the owner's
  fixtures (minimum OKLab distance `planner.palette.minDistance`).
- Colour changes happen only at section or phrase boundaries or intentional
  motif returns (spec 29); the evaluator measures it.
- Colour interpolation uses the mixer's blend space (DS-09); no sRGB
  interpolation anywhere in the planner. `blendRgb` is replaced by the colour
  module shared with the mixer and renderer.
- DoD: `P-28` (all fields populated, renderer colours come only from the plan);
  `P-29` (100 percent of colour changes on boundaries or motif returns on
  every validation track); validation tracks show 2 to 3 core colours.

### T-PLAN-03 Six-level hierarchy with future-aware progression

- Closes: F-PLAN-04; probes `P-2.1-future-aware-build`, `P-2.4-six-levels`,
  `P-30-level-rules`.
- Plan top-down: track arc (intensity arc over the whole track), sections
  (brightness range, palette, density, movement family, ceiling, darkness),
  phrases (variation, direction, progression, fixture participation), bars
  (chase direction, alternation, small variations), beats (pulses, bumps,
  hits, switches), sub-beats (brief strobes, rolls, impact textures) per
  spec 30. Each level may only change the attributes the spec assigns to it;
  the validator enforces the table.
- Future knowledge first (spec 2.1): the planner reads upcoming events and
  plans backwards from them: a drop at beat 257 produces a staged build from
  its build start, pre-impact darkness, palette evolution toward the drop's
  colours, foreshadowing (brief glimpses of the drop motif in the build), and
  a varied second drop.
- DoD: `P-2.1` (staged cues between build start and impact with increasing
  density; darkness ending exactly at the impact beat); `P-2.4` (all six
  levels present); `P-30` (a cue that changes a forbidden attribute at its
  level is rejected by the validator).

### T-PLAN-04 Primitive library: every spec primitive plus the spatial set

- Closes: F-PLAN-03, F-PLAN-15; probes `P-31-primitive-registry`,
  `P-79-movement-vocabulary`.
- Registry of every spec 31 primitive: StaticLook, GradientLook, Pulse, Bump,
  DecayHit, Alternate, Chase, Sweep, MirrorSweep, OutsideIn, InsideOut,
  Split, Wave, BuildRamp, PhraseTurn, FillAccent, Impact, WhiteHit, Blackout,
  Dip, Reveal, StrobeBurst, RollPattern, DropPattern, BreakdownLook,
  VocalFocus, OutroRelease; the spec 79 movement vocabulary (rise, fall,
  cross, fan, converge, diverge, chase, outside-in, inside-out, vertical scan,
  rotation around venue topology); and the WP05 spatial primitives (Orbit and
  PerimeterOrbit, Ripple, RadialPulse, OpposedPulse, Converge, Diverge, Radar,
  SplitAlternate, QuadrantRotate, WallStep, CornerHits, Fill, Unfill,
  GradientRotate, Spiral, Breathe, Mirror, SymmetricSweep, SpatialWipe,
  GroupHandoff, TextureHold, FinalHit).
- Each primitive has: a Zod parameter schema, the coordinate system it
  samples (WP05 section 1.2), capability requirements (for example Orbit needs
  a closed loop or an independent split; StrobeBurst needs a fixture rate at
  least twice the strobe rate), energy class, suitable section kinds,
  restraint costs (which budget counters it consumes), the renderer function
  (`T-REND-02`) and golden frames.
- The planner generates strobes (StrobeBurst, sub-beat textures) where the
  music and style call for them, within budgets, so strobe invariants are
  testable (F-PLAN-15).
- Unknown primitive types are rejected (WP05, `P-ROOM-08`).
- DoD: registry test lists every name above; every primitive has a golden per
  reference room; a plan for an EDM validation track contains strobe cues
  within the duty budget.

### T-PLAN-05 Restraint engine

- Closes: F-PLAN-07, F-PLAN-15, F-APP-12; probes `P-34-restraint`,
  `P-78-blinder-budget`.
- State (spec 34): `lastBlackoutBeat`, `lastWhiteHitBeat`, `lastStrobeBeat`,
  `strobeDuty` (rolling), `lastPaletteChange`, `currentPatternFamily`,
  `patternRepeatCount`, `recentSpatialDirections`, `recentImpactTypes`,
  `sectionImpactCount`, `wholeTrackImpactCount`, plus blinder usage (spec 78).
- Every candidate cue passes through restraint, which may accept, substitute
  (the spec example: a white hit four beats after the last one becomes a
  full-colour impact) or reject, with a recorded reason. Thresholds are
  `planner.restraint.*` config, scaled by the style.
- The manual "blinder on phrase" control (F-APP-12) becomes a restraint-aware
  request: it fires on real phrase boundaries, within the blinder budget, and
  cannot vanish mid-duration.
- Restraint also governs live decisions (adaptive director, FLX4 hints) via a
  runtime instance of the same engine.
- DoD: `P-34` (the spec example); `P-78` (blinder budget); a property test:
  for any generated track, no two white hits closer than
  `planner.restraint.whiteHitMinBeats` without a recorded justification;
  diagnostics list every substitution and rejection.

### T-PLAN-06 Contrast engine and drop programming

- Closes: F-PLAN-08; probes `P-35-contrast`, `P-36-drop-sequence`.
- Breakdown: low brightness, large dark areas, slow motion, few active
  segments, narrow palette. Build: increasing fixture count, spatial speed and
  brightness, shorter movement period, controlled palette tension. Final
  pre-drop beat: optional full blackout. Drop: white impact, brief decay,
  saturated reveal, high spatial movement; chosen by event strength and
  history (spec 35).
- Drop programming structure (spec 36): staged ramps over
  `planner.drop.stages`, desaturation toward white, pre-drop darkness
  (`planner.drop.preDarknessBeats`), impact of `render.impact.defaultMs`
  converted through tempo at render time, quantized burst
  (`planner.drop.burstBeats`), saturated drop body with spatial alternation.
  Fake drops (`fakeImpactBeat`, `actualImpactBeat`) get black, hold, hold,
  impact on the actual beat.
- DoD: `P-35` (breakdown mean brightness below
  `planner.contrast.breakdownMaxMean`, build brightness slope positive, both
  from frame sampling); `P-36` on the spec example model reproduces the
  structure (not the exact colours); fake-drop test fires nothing at the fake
  impact.

### T-PLAN-07 Consume every event with its confidence and strength

- Closes: F-PLAN-09.
- Every event type from `T-ANA-10` maps to planning behaviour: section and
  phrase transitions (PhraseTurn, look changes), build start and
  intensification (BuildRamp stages), predrop, drop, fake drop, drop
  continuation, breakdown (BreakdownLook), bass and drum re-entry (Impact or
  Reveal scaled by strength), vocal entry and exit (VocalFocus), fills
  (FillAccent), pause and silence (Dip or Blackout within budget), large
  transient (Bump), final hit (FinalHit), outro release (OutroRelease).
- Confidence gates use (`planner.events.minConfidence` per type); strength
  scales intensity and choice. Low-confidence events produce softer cues,
  never nothing and never full impacts.
- DoD: a test per event type; a low-confidence drop gets a Reveal, not a
  WhiteHit.

### T-PLAN-08 Recurrence and motif memory

- Closes: F-PLAN-05; probes `P-2.6-motif-return`, `P-37-variation-fields`.
- Build a similarity matrix between sections from All-In-One embeddings,
  beat-feature summaries and native labels; sections above
  `planner.recurrence.similarityThreshold` share a motif ID. A MotifMap
  records each motif's base look and the variation applied at each
  occurrence: direction, secondary colour, density, participating fixtures,
  accent timing (spec 37).
- Dissimilar sections never share a motif; a returning chorus is
  recognizable and not identical.
- DoD: `P-2.6` and `P-37` pass on validation tracks with repeated choruses.

### T-PLAN-09 Show styles

- Closes: F-PLAN-06, F-PLAN-17, F-APP-18; probe `P-135-styles`.
- `ShowStyle` with all 11 spec 135 properties, every one used by the planner
  (a test mutates each property and asserts the plan changes in the expected
  direction). Seven built-ins with the spec names: Club, House, Festival,
  Lounge, Pop, Dark, Minimal; the default produces a good show without
  configuration.
- All planner numbers (`SECTION_ENERGY` and the rest) are `planner.*` config
  keys that styles can override; custom styles are saved (T-DATA-02) and
  edited in the style editor (`T-UI-14`).
- DoD: `P-135` (diagnostics per style differ in the expected directions: Dark
  has more darkness percentage than Festival, Minimal has lower density, and
  so on); no hardcoded planner numbers remain (T-CFG-04 rule).

### T-PLAN-10 Validator and evaluator in production

- Closes: F-PLAN-10; probes `P-114-invariants`, `P-115-diagnostics`.
- Validator runs on every compile and rejects plans that violate spec 114
  (no overlapping exclusive blackouts; no negative durations; no palette
  change every beat unless the section is marked special; no uncontrolled
  full-room strobe from live audio; no repeated major white impact without
  justification; no fixture command unsupported by the venue capability
  class; no event outside the source duration; every cue evaluates
  deterministically at arbitrary beats) plus the level rules of T-PLAN-03.
- Evaluator computes all ten spec 115 diagnostics from sampled frames
  (rendered through the real renderer on a reference venue of the same
  capability class): active-cell density, darkness percentage, colour-change
  rate, white-hit count, blackout count, strobe duration, pattern recurrence,
  spatial-direction entropy, section contrast, whole-track intensity arc.
  Pathological results (outside `planner.evaluation.bounds`) reject the
  generation and trigger the next candidate (DS-19).
- DoD: each invariant has a failing example test; diagnostics visible in the
  Inspector; bounds are config.

### T-PLAN-11 Corrections, locks and regeneration

- Closes: F-PLAN-11; probe `P-97-corrections`.
- Stable cue IDs (derived from the seed, section, level and ordinal, not array
  index). `PlanEdits`: moved events (for example drop moved two beats), section
  kind overrides, locked regions, pinned cues, deleted cues, style overrides
  per section. Regenerating a section preserves locks and every edit outside
  it; edits persist in the database (`show_edits`, T-DATA-02) and survive
  planner version upgrades where they still apply (with a report of any that
  no longer apply).
- DoD: a unit test regenerates a middle section and asserts every cue ID
  outside it is unchanged; locks and edits survive a restart (integration
  test with the database) and a planner version bump. The UI probe `P-97` is
  proven in `T-UI-07`.

### T-PLAN-12 Candidate scoring hook (DS-19)

- Closes: F-PLAN-14; probe `P-113-scoring-hook`.
- `planner.mode`: `rules` (deterministic rule output), `scored` (the rules
  produce `planner.candidates.perSection` candidates per section and
  registered evaluators pick), `rules-with-veto` (default: rules output;
  evaluators may veto pathological sections and pick the next candidate).
  Evaluators are pure functions registered by name; the built-in set uses the
  spec 115 diagnostics. A learned evaluator can be registered later without
  changing the planner (spec 113); none is required. Spec 112: the 2026
  Skip-BART and SeqLight repositories have no license file, so they are
  research inspiration only; no code, weights or data from them enter the
  tree or the installer (checked in `T-TRU-10` and `T-DOC-04`).
- DoD: `P-113` with a dummy evaluator; each mode tested for determinism.

### T-PLAN-13 Layer tags and mixing metadata

- Closes: F-MIX-06 dependency (mixer introduction stages use layer semantics).
- Every cue carries its spec 33 layer; sections carry mix hints (intro and
  outro regions suitable for blending, the "incoming track" palette summary,
  and where exclusive impacts are structurally significant). The mixer uses
  these instead of priority heuristics (`T-MIX-05`, `T-MIX-03`).
- DoD: schema test; mixer tests consume the tags.

### T-PLAN-14 Compile performance and caching

- Closes: spec 138 ("planner compilation runs quickly from cached features").
- Measure compile time on the validation set; target p95 under
  `planner.compile.budgetMs` on the reference Mac. Cache plans keyed by the
  five determinism inputs (T-DATA-03). Incremental recompile for a single
  section edit.
- DoD: benchmark JSON in evidence; cache hit test.

### T-PLAN-15 Planner goldens and regression

- Closes: F-PLAN-12; probe `P-129-no-self-write`.
- Goldens for each validation track and the synthetic planted-event tracks:
  plan summary (sections, motif IDs, cue counts by type and level, globalDesign)
  plus renderer frame hashes at key beats. A missing golden fails the test.
  Updates only through `yarn golden:update --reason "<text>"`, which writes
  the reason and the diff summary to `test-fixtures/goldens/CHANGELOG.md`.
- DoD: deleting a golden makes the test fail (red run saved); a deliberate
  planner change produces a readable diff.

## 3. Config keys added (added to `03` section 3.3)

`planner.palette.minDistance` (0.12 OKLab), `planner.events.minConfidence`
(per type map, 0.5 default), `planner.evaluation.bounds` (map of the ten
diagnostics to allowed ranges), `planner.compile.budgetMs` (2000). All
unmeasured targets.
