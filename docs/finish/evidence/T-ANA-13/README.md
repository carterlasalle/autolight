# T-ANA-13: Artifact identity, versioning and atomic writes

Closes F-ANA-18; probe P-82-invalidation (analysis part).

## What changed

- `artifacts.py` (new): `analyzer_version` from package metadata;
  `source_fingerprint` streams the whole file and mixes decode settings, so
  tag edits do not change the key and audio edits do; `artifact_name` binds
  the fingerprint with schema, analyzer and config hashes; `atomic_write`
  writes a temp sibling, fsyncs and `os.replace`s, cleaning up on failure;
  `default_cache_dir` is under the user directory, never /tmp.
- `worker` takes duration from the decoded audio and stores through
  `atomic_write`; the artifact name comes from the fingerprint chain.

## Proof

- Covered indirectly by `uv run pytest tests/test_worker.py -q` (artifact
  written and re-read, schema valid, deterministic name inputs).
- Interrupted-write behavior: the temp file keeps a `.tmp.` prefix until the
  replace, so a crash leaves the previous artifact; a dedicated crash test is
  listed as a gap.

## Delete test

Replace `os.replace` with an in-place write and a crash between write and
rename corrupts the artifact; remove the settings from the fingerprint and
the tag-edit key test (decode suite) fails.

## Seams

- Config snapshot hash feeds `analysis_jobs` rows in T-DATA-02 storage.
