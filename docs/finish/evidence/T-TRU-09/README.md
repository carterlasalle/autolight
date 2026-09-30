# T-TRU-09: Python lint and types

Closes scar S5 in Python, F-QA-14 (Python static checks).

## What changed

- `uv add --dev ruff pyright pytest-cov`: pinned in the analysis dev group.
- `analysis/pyproject.toml`: Ruff target py312, rule set BLE/S/E/F/ARG/I/SIM/RUF,
  per-file ignores for tests only (SIM115, S101, PLR2004, ARG). Production
  `src/` gets zero ignores.
- `yarn truth` runs Ruff and pyright via `uv run` (commands below).
- Named every blind except in the touched path:
  - `worker.py` audio load: `(OSError, ValueError, RuntimeError,
    subprocess.CalledProcessError)` (ffmpeg decode failures).
  - ML structure and cross-check: `(ImportError, OSError, ValueError,
    RuntimeError)` (advisory inputs, pipeline stands alone).
  - DSP guard: `(ValueError, RuntimeError, OSError)` with `dsp-fallback`
    evidence preserved.
  - Top-level `handle` guard keeps `except Exception` with `noqa: BLE001`
    plus reason: any failure becomes a typed failed frame, never a dead
    worker (spec 14, 109).
  - `native.py` EXT/2EX fallbacks keep `noqa: BLE001` with reason
    (pyrekordbox raises ConstError on unknown variants); PSSI/cue/tag reads
    narrowed to `(AttributeError, ValueError[, IndexError])`.
- Fixed real bugs surfaced by the linter:
  - F821 `events` use-before-assign in the ML block (the F-ANA-01 class):
    initialized `events: list[dict] = []` before the ML try, and ML
    boundaries now append (`events + detect_drops(...)`) instead of being
    overwritten by the drop assignment.
  - F-ANA-13: `novelty` param unused (ARG001) is now wired into the drop
    vote (`max(bj, dj, ej, nj)`).
  - Pyright: `beats: list[float] | list[int]` on both detectors (worker
    passes ints); `max(... or 0, ... or 0)` on optional impact beats.
- `ruff format` runs clean on the touched files; the full-tree format blast
  was tried and reverted (22 files reflowed, no semantic change): formatting
  the untouched DSP modules belongs to the T-ANA tasks that rewrite them.

## Proof

- `ruff check` on worker.py, native.py, structure.py: all checks passed.
- `pyright` on the same three files: 0 errors.
- `uv run --project analysis pytest -q`: 46 passed, 2 skipped.
- Full-src Ruff still reports the pre-existing backlog (line length,
  subprocess audit, partial paths) in untouched modules: recorded as ratchet
  for T-ANA tasks, not waived.

## Ratchet for T-ANA

Remaining src findings by rule (2026-09-30): E501 x11, S603 x4, S607 x2,
RUF002/3 x2, S108 x1 (one justified in worker), I001 x1, ARG001 x1.
Each T-ANA task clears its module's rows; counts may never grow.

## Delete test

Reintroduce `except Exception: pass` in worker.py and Ruff BLE001 plus S110
go red. Delete the `events` initialization and F821 plus the worker tests go
red.
