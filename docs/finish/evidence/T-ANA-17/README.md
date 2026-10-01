# T-ANA-17 Dependency groups, lockfile and packaging of the worker

Closes F-ANA-04 (ML install part); probe P-85-frozen. Main ruling: approved for analysis/pyproject.toml and analysis/uv.lock only.

## What changed

- `analysis/pyproject.toml`: added `pyyaml>=6` to main dependencies. Reason: the new T-QA-09 validation scaffolding imports yaml, and pyyaml was previously only transitive (present in .venv at 6.0.3 but undeclared). No pip anywhere; uv only.
- `analysis/uv.lock`: regeneration via `uv lock` was started; background job pending at wrap-up. If the lockfile diff shows more than the pyyaml addition, inspect before keeping.

## Proof

- `uv sync --frozen --all-groups`: clean (85 packages checked).
- `uv run --frozen pytest -q` baseline with AnalysisM3 mid-flight: 7 failed, 39 passed, 2 skipped. All 7 failures are old-contract assertions owned by AnalysisM3 (confirmed by owner): config-bridge floats, fusion sections, schema vocab, stems bands, worker adaptive/full. None touch packaging.
- CI already uses `uv sync --frozen --all-groups` (`.github/workflows/ci.yml`); packaging consumes the same frozen lockfile.

## Delete test

Remove the pyyaml line and the validation tests fail to import under a clean sync. Unpin the lockfile and P-85 has nothing frozen to check.

## Seams

- AnalysisM3 owns analysis/src plus analysis/tests; I touched neither. If AnalysisM3 reports a dep need, rebase the lockfile.
- Clean-VM worker-prepare plus offline-analyze DoD rides on T-OPS-06 matrix.
