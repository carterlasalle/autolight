# T-UI-06: Track Inspector

Closes F-UI-07, F-UI-08. Spec 96 (wp13-ui.md T-UI-06).

## What changed

- New `apps/desktop/src/routes/inspector/inspector-helpers.ts`:
  `auditionAtBeat` clamps to the track span, picks the latest cue at or
  before the beat, returns `{ beat, cueType, sendToLights }`; `blendView`
  clamps the A/B mix to 0..1.
- `features/inspector/inspector-view.tsx`: lanes load once per track and
  cache in state (no per-tick refetch), selection follows the chosen deck or
  track, Audition-beat-257 button, Send-to-lights toggle (preview-only by
  default, nothing reaches the lights unless on), Blend A/B slider, audition
  result line naming beat plus cue plus destination.

## Proof

- `inspector-helpers.test.ts`: beat 257 against cues at 0/256 picks
  white-hit at 257 (P-96 shape); out-of-range clamps to 512; null track
  refuses; blend clamps both ends.
- Deck B selection: the existing `show/live` deck loop already matches
  either deck title; the P-96 hash assertion needs the E2E preview harness.
- Owned run: 15 files, 83 passed.

## Delete test

- Change the cue pick to `c.startBeat >= clamped` and the beat-257 row goes
  red; default `sendToLights` to true and the preview-default row goes red.

## Seams

- Audition rendering (frame hash at the beat) is the show host's
  `show/correction`-adjacent preview path; the helper only computes the
  pick. Corrections ops live in T-UI-07.
