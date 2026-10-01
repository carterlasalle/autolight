# T-ANA-08: GRID_WARNING from a real comparison

Closes F-ANA-16; probe P-17-grid-warning.

## What changed

- `metrical.compare_grids`: over all anchors it reports median and 95th
  percentile offset, drift between halves, and sustained-shift segments
  with the anchor range; the warn rule needs the configured anchor minimum
  (`analysis.gridWarning.minAnchors`) and tolerance
  (`analysis.gridWarning.toleranceMs`, default 50 ms).
- `metrical_vote` emits typed `gridWarnings[]` entries with evidence tags
  (offset median, p95, drift) and the affected `beatRange`; the model carries
  them in `gridWarnings`.
- The fake `section-transition` event at beat 1 and its duplicate append are
  deleted from `worker.analyze_job`.

## Proof

- `uv run pytest tests/test_grid_stems_harmony.py -q`: an aligned grid raises
  nothing; a grid shifted 250 ms after bar 64 warns with a named segment; the
  typed warning round-trips through the vote with beatRange.
- `uv run pytest tests/test_metrical.py -q`: legacy first-anchor behavior.

## Delete test

Raise `minAnchors` above the fixture length and the shifted-grid warning test
fails; delete the segment loop and the segment assertion fails.

## Seams

- The Inspector badge is proven in T-UI-06; the grid is never altered here.
