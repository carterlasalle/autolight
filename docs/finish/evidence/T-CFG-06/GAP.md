# T-CFG-06: Decision switch framework (gap close)

Closes F-DEC-01 (DS-01 to DS-36). Wave 1 built this task; this note records
only the gap review from the mixer/director/overlay side, no rewrite.

## Gap review

- Checked every config key this slice reads against `packages/config/src/registry.ts`
  and `decisions.ts`: `runtime.adaptive.phraseBeats`, `cooldownPhrases`,
  `engine` (DS-28), `minLooks`, all mixer crossfader/weight/intro/
  blackout/owner/blendSpace keys, `render.tickBudgetMs`,
  `render.gammaDefault`, `audio.overlay.cap`, `audio.agc.*`,
  `audio.onset.threshold`. All present with defaults matching the code
  (`phraseBeats` 32, `cooldownPhrases` 2, `minLooks` 24, `tickBudgetMs` 4,
  `overlay.cap` 0.2).
- The director's `DirectorOptions` field names mirror the registry keys so the
  runtime owner can pass configured values straight through; the overlay's
  `cap` parameter is the configured `audio.overlay.cap`, multiplied by
  `style.reactiveAmount` per spec 68.
- No gaps found. `packages/config` was not touched by this slice (outside its
  target paths); the config package's own suite passes (15 tests).

## Proof

- Grep of `registry.ts`/`decisions.ts` for the keys above (all hit); scoped
  `yarn workspace @autolight/config test` passes. No source edited by this
  slice.
