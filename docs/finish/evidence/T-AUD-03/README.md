# T-AUD-03: Overlay rules

Closes F-AUD-02, F-AUD-04, F-APP-20 (overlay part); probe `P-69-no-relight`
(spec 69, spec 68).

## What changed

- New `packages/reactive-audio/src/overlay.ts` (re-exported from the package
  index by RunAudioM2): the only overlay implementation new code should use.
  `overlayAmount` is `audio.overlay.cap` times `style.reactiveAmount` (spec 68:
  the exact percentage is style-dependent, the cap keeps it subtle);
  `DEFAULT_OVERLAY_CAP` (0.2) retires the hardcoded `MAX_OVERLAY_GAIN` as a
  named default callers override from config. `applyOverlayScalar` scales
  planned light in linear 0..1; `applyOverlayLinear` scales RGB with the same
  factor on every channel.
- The two F-AUD-02 invariants hold by construction: black stays black (0 maps
  to 0 at any energy; zero channels stay zero) and hue is preserved (one
  shared gain in linear light, so channel ratios never change). The bump is
  bounded by `planned * amount` and the result never exceeds 1. The module
  takes planned light plus energy and returns scaled light, never a cue,
  palette, section, drop, or strobe, so the spec 69 forbidden list is
  structurally unreachable.
- The legacy `applyOverlay` in `packages/reactive-audio/src/index.ts` is
  untouched (RunAudioM2 owns that file) and still called by
  `apps/desktop/src/features/live/live.ts` (outside this slice's target
  paths). Migrating that caller to `applyOverlayScalar`/`applyOverlayLinear`
  and deleting the legacy function belongs to the UI slice that owns live.ts.

## Proof

- `packages/reactive-audio/src/overlay.test.ts` (`P-69-no-relight`): black
  stays black at maximum energy; the bump at maximum input equals
  `cap * reactiveAmount` (0.5 at amount 0.5 with cap 0.2 becomes 0.55);
  every channel scales by the same factor (hue preserved, zero channels stay
  zero); silence or zero style amount returns planned light unchanged; wild
  inputs clamp to [0, 1].
- Scoped runs this session: `yarn workspace @autolight/reactive-audio test`
  gives 5 files, 31 tests passed (overlay, legacy index, capture, DSP,
  timing); the built overlay gives black 0, bump 0.55, RGB
  [0.66, 0.33, 0.165] for [0.6, 0.3, 0.15] at full energy and amount 0.5, and
  0.7 unchanged at silence.
- The legacy per-channel additive bug is still observable in the old function
  (adds the same gain to every channel including zeros); that is exactly what
  the new module replaces, once the UI caller migrates.

## Delete test

Add the gain to zero channels and the black-stays-black assertions go red.
Scale channels with different gains and the same-factor assertion goes red.
Replace `cap * reactiveAmount` with the fixed 0.2 and the amount-0.5
assertion (0.55) goes red. Return `planned + gain` instead of
`planned * gain` and the bound assertions go red.

## Seams

- Live.ts migration: replace the per-channel `applyOverlay(blended, energy,
  amount)` call with one `applyOverlayLinear` per pixel (or per byte buffer
  in linear light), then delete `applyOverlay`/`MAX_OVERLAY_GAIN` from the
  audio index. Owned by whoever owns `apps/desktop/src/features/live`.
