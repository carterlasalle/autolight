# T-TRU-13: Record the scars in AGENTS.md

Closes F-DOC-06.

## What changed

- AGENTS.md canonical commands filled with commands actually run: install,
  dev (`yarn dev`), focused test (per-package vitest plus per-file pytest),
  full test (vitest workspace plus pytest plus e2e), lint (ast-grep scan,
  forbidden words, Ruff), typecheck (foreach tsc plus pyright), build
  (`yarn build`), DoD (`yarn truth` plus `yarn verify:all`). Zero TBD in the
  canonical block.
- Scars S1 to S28 recorded one line each with the exhibiting file.
- Repository memory filled: configuration (240-key registry), architecture
  boundaries (depcruiser rules), source-of-truth files (catalog owns
  registry, Zod owns Python models, manifest owns README table, STATUS owns
  task state), test topology (47 files, 232 tests, journeys path, replay,
  goldens).

## Proof

- `grep TBD` in the canonical commands block: zero hits.
- `grep -c "S1 \|S28 "` shows the scar range present.
- Remaining TBDs elsewhere in memory (domain vocabulary, complexity budgets,
  persistence guarantees) belong to tasks that set those numbers (M1-M6);
  the T-TRU-13 bar (canonical commands plus scars) is met.

## Delete test

Delete any scar line and the next agent rediscovers the failure; delete a
canonical command and the quickstart loses its copy source.
