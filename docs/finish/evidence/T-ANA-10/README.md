# T-ANA-10: Event detectors for all 19 events

Closes F-ANA-11, F-ANA-12, F-ANA-13, F-ANA-14; probes P-22-event-vocabulary,
P-23-build, P-24-drop, P-25-fake-drop.

## What changed

- `events.py`: `EVENT_TYPES_19` and `build_score` (nine spec 23 features:
  energy, drum density, high frequency/centroid, onset density, bass movement,
  PSSI Up, boundary confidence, harmonic tension) with evidence per feature;
  `drop_score` consumes all spec 24 inputs with evidence per input.
- `structure.py`: candidates are real `beatInBar == 1` downbeats (threaded
  through `detect_builds` and `detect_drops`); no restraint inside the
  detectors; builds score the final contiguous rise of each window (plateaus
  cannot inflate a score) and merge starts under 8 beats apart; fake-drop
  pairs come from a dedicated pre-pass (expected impact withheld in silence,
  vocal-fake or held-tension, real slam 1 to 4 beats later, gated on a recent
  approach so a breakdown tail cannot fake it) with `fakeImpactBeat`,
  `actualImpactBeat` and `variant`; main-loop impacts dedupe inside an 8-beat
  window across pairs and candidates; re-entries, transitions, one breakdown
  per run, fills, pauses, silences, transients, final hit, outro release,
  predrop (never on a fake-drop beat) and sustained drop continuation emit.
- `worker` wires the fused phrases, stems, vocal, fills, onset and harmonic
  tension into the detectors and emits build start plus intensification.

## Proof

- `uv run pytest tests/test_structure.py tests/test_events_full.py -q`: green.
- `uv run pytest tests/ -q --ignore=tests/owner` from `analysis/`: 85 passed.
- Plante-event metrics (T-ANA-16 instrumentation): 18 event types planted, all
  recall 1.0 at tolerance 1 beat, 26/26 found with micro precision 1.0.
- `WEAKEN=1 uv run pytest tests/test_events_full.py -q` fails 2 tests
  (planted recall collapses), so the detectors are load-bearing.

## Delete test

Delete a detector (for example fills) and its planted recall drops to zero;
delete the dedupe and the precision gate fails on repeat impacts.

## Seams

- Thresholds come from config (analysis.drop.*, analysis.build.*,
  analysis.fakeDrop.gapBeats); the planner consumes confidence and strength
  separately.
