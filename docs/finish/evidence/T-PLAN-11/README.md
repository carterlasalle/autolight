# T-PLAN-11: Corrections, locks and regeneration

Closes F-PLAN-11; probe `P-97`.

## What changed

- `src/corrections.ts`: `cueId` from seed/section/level/ordinal (never array index); `regenerateWithLocks` keeps outside-region cues, keeps locked-region cues, drops unlocked in-region cues, applies fresh and pinned cues, honors deletions, reports dropped fresh ids; `applyEdits` reports applied counts and exactly which edits no longer apply after a planner upgrade.
- Compile honors `movedEvents`, `sectionKindOverrides`, `lockedRegions` (via restraint-safe planning), `pinnedCues`, `deletedCueIds`, `sectionStyles`.

## Proof

- `src/corrections.test.ts`: id stability across inputs; middle-section regen preserves every outside cue id and beat; deletions stick while locked regions survive; stale lock regions are reported as no-longer-applying.

## Delete test

Derive ids from array index and the regen-stability case goes red on any insertion. Skip the deletion filter and the deletion case goes red. Drop the report and the stale-edit case goes red.

## Seams

Edits persist in `show_edits` (T-DATA-02) and survive planner upgrades with a report. UI probe P-97 is proven in T-UI-07; legacy index-based `regenerateSection` stays for the old unit test only.
