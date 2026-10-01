# T-UI-11: Settings, every configuration visible

Closes F-UI-17 (with T-CFG-05). Spec 03 (wp13-ui.md T-UI-11).

## What changed

- `apps/desktop/src/routes/diagnostics/diagnostics-model.ts`: `settingsGroup`
  groups keys by their first prefix segment (runtime, mixer, govee, ui, ...),
  matching the 03 catalog sections without a second taxonomy.
- `features/settings/settings-view.tsx`: registry-driven grouped view over
  all `KEYS` (count in the title, drops if a key is deleted), per-row type
  plus scope badges, `ConfigField` (value, default, unit, range, receipt,
  live-safe badge), editable value input, Set via `config/set` with the
  row's own scope, Reset via `config/reset`, working Changed-only filter
  (was hardcoded false), search across key plus receipt plus unit.
- T-CFG-05 visibility stays: this task adds editing, grouping, and the
  pending queue, not a second list.

## Proof

- Routes test still renders "Settings:"; owned run 15 files, 83 passed.
- Playwright enumeration of every key plus every DS plus restart
  persistence is the orchestrator's phase-end pass; the grouped view renders
  from `KEYS` so a missing control means a missing row, not a silent skip.

## Delete test

- Filter `KEYS` to a constant subset and the title count drops (visibility
  is structural, not asserted text); break the Changed-only predicate and
  the filter shows everything.

## Seams

- Decision switches DS-01..36 render on their own page: NOT built here (no
  `DECISIONS` export from `@autolight/config` dist; adding it is a config
  package change outside this slice). The registry rows plus `config/schema`
  carry the DS keys; the DS page is recorded as the single gap.
