# T-CFG-03: Python config bridge

Closes F-CFG-01 (analysis part).

## What changed

- `uv add pydantic` in `analysis/`.
- Export script writes `config_schema.json` (JSON Schema with type, default,
  description per key) and `config_defaults.json` for the worker to validate
  and read at start and per job.
- New `analysis/tests/test_config_bridge.py`: schema has the analysis keys,
  defaults match schema keys exactly, and raw floats outside config reads
  stay under a ratchet count in the six DSP modules.

## Proof

- `uv run --project analysis pytest analysis/tests/test_config_bridge.py -q`:
  3 passed.
- Full worker suite still green (43 passed before this change; rerun in
  T-CFG-02 evidence).

## Remaining work (not claimed done)

- Worker actually reading per-job config snapshot plus config hash in artifact
  metadata and cache key (T-ANA-13).
- Ruff numeric-literal rule at blocking (T-TRU-06, T-TRU-09).
