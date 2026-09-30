# T-CFG-04: no-magic-number rule baseline

Closes the rule part of F-CFG-01, F-PLAN-17, F-AUD-04, F-GOV-11 (rule and baseline only, not the migration).

## What changed

- New rule `tools/ast-grep/rules/no-magic-number.yml` (severity warning, baseline): pattern based (`pattern: $NUM` plus `kind: number`), shaped like the existing `no-string-ipc.yml`. It flags numeric literals outside the allowlist: `0`, `1`, `2` (and `-1` as a unary sentinel, which the AST sees as literal `1`), array index math (literals inside `subscript_expression` are excluded), and bit masks in protocol codecs that cite a protocol constants file (documented in the rule note; the codec literals still flag until the per-package tasks move them).
- Scope is the T-CFG-04 package list via `files`: `packages/show-mixer`, `show-planner`, `show-runtime`, `renderer`, `venue`, `govee`, `dj-core`, `reactive-audio`, `rekordbox-library`, `rekordbox-live`, `serato`, `controller-flx4`, `analysis-client` (all `src/**`), plus `apps/desktop/electron/**`.
- Baseline recorded in `tools/ratchet.json` under `rules.no-magic-number`: count 311, `blocking: false`. No other ratchet key touched.

## Count

- 311 findings in production sources (test files excluded: `*.test.ts` report 318 more, for 629 total including tests).
- Per file (production only): show-planner 99, renderer 40, govee 38, serato 35, rekordbox-library 29, follow.ts 8, reactive-audio 8, show-runtime 9, controller-flx4 15, show-mixer 5, govee-lan.ts 5, main.ts 5, show-service.ts 5, venue 4, rekordbox-live 4, dj-core 2. Zero hits in `packages/analysis-client/src` and `apps/desktop/electron/ipc.ts` plus `preload.ts`.
- Spot check: `packages/show-mixer/src/index.ts` flags the known catalog values (`0.3` blackout threshold, `0.05`/`0.3`/`0.7` introduction stages, `11` priority bound); `packages/dj-core/src/index.ts` flags `1e9` (ns to s) and `0.25` (seek default) as intended.

## Proof

- `sg scan --config tools/ast-grep/sgconfig.yml --filter no-magic-number`: rule parses, 311 production findings (629 with tests), zero errors from the rule itself.
- `sg scan --config tools/ast-grep/sgconfig.yml` (full project): still green apart from the known `no-string-ipc` warnings; the new rule adds only warnings, so no error gate trips.

## Remaining work (not claimed done)

- T-CFG-04 migration (zero findings) is claimed by later per-package tasks, not this one. Each task moves its literals to `@autolight/config` or a protocol constants file, drives the ratchet count down without exclusions or suppressions, and flips this rule to `blocking` at zero.
