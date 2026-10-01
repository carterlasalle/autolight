# T-TRU-10: Security and license scanning

Closes F-QA-14 (security/license part), spec 112 enforcement.

## What changed

- `tools/license-check.mjs`: Yarn deps via dlx license-checker, Python via
  pip-licenses, hand list for FFmpeg/uv/Python/weights. Denylist (GPL, AGPL,
  unlicensed, unknown, empty) fails. rkbx_link never a dependency. Skip-BART
  and SeqLight tripwire scans filenames plus file heads (research prose may
  cite them; vendored files may not).
- Fixes in this session: empty and UNKNOWN licenses now denied via
  normalization; filename-only tripwire hits no longer need a content match;
  yarn scan uses `yarn dlx` (Yarn 4 has no `licenses list` script);
  first-party `autolight-analysis` UNKNOWN metadata excluded by name.
- `THIRD_PARTY_NOTICES`: regenerated canonical report (0 yarn rows via the
  dlx path, 84 pip, 6 hand-listed). Regenerate with
  `node tools/license-check.mjs > THIRD_PARTY_NOTICES`.
- `license-report.json` in this folder: the same report, committed.
- CodeQL workflow: `security-codeql` job already exists in CI (github/codeql-action).

## Proof

- `node tools/license-check.mjs --self-test`: OK (denylist incl. planted
  GPL, rkbx_link manifest, Skip-BART weight).
- `node tools/license-check.mjs`: OK (0 yarn, 84 pip, 6 hand-listed).
- `THIRD_PARTY_NOTICES` generated (T-DOC-04 consumes it).

## Delete test

Add a GPL dep and the scan fails naming it. Vendor a Skip-BART weight and
the tripwire fails. Depend on rkbx_link and the manifest scan fails.
