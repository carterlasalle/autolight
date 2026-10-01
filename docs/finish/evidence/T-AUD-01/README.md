# T-AUD-01: Capture host outside React (DS-14)

Closes F-AUD-03, F-AUD-05, F-APP-20 (capture part).

## What changed

- `packages/reactive-audio/src/capture.ts` (new; re-exported from
  `index.ts`): the host-side logic the app wires to its dedicated capture
  window, owned outside React.
  - `resolveCaptureHost`: DS-14 mode resolution. `audio-window` is the
    default, `renderer` is kept for comparison, and
    `audio-window-with-renderer-fallback` falls back to the renderer only when
    the hidden window is unavailable, with the fallback recorded on the
    status.
  - `captureConstraints`: `audio.capture.deviceId` is applied exactly
    (`deviceId: { exact: id }`); an empty id means `audio: true`. The
    constraint is never dropped.
  - `AudioCaptureHost`: real permission states (`granted`, `denied`,
    `not-requested`), idempotent `start` (a second start reuses the running
    context: one context, one permission request) and idempotent `stop` (no
    second stop, no leaked loop), `setDevice` switching with exactly one live
    context, `onUiReload` keeping the audio-window session alive while the
    renderer session stops, and a bounded latest-wins feature stream
    (`publish` / `latest` with `received` and `superseded` counters).
  - `recommendLoopbackDevice`: the Setup recommendation for capturing the DJ
    output rather than a microphone.

## Proof

Command (from `packages/reactive-audio`):

```
../../node_modules/.bin/vitest run src/capture.test.ts
```

Observed: `Tests 8 passed (8)` (part of the package run `Tests 26 passed
(26)`).

- `resolves DS-14 modes, with the combined fallback recorded`: all three
  modes, plus the status of a combined host with no audio window (host
  `renderer`, `fellBack true`).
- `applies the audio.capture.deviceId constraint exactly`: empty, blank and
  trimmed ids.
- `starts once, stops once and switches device with one live context`:
  `starts` is 1 after two `start()` calls, one permission request, the switch
  stops the old context and starts the new one with the exact constraint,
  two `stop()` calls produce one stop.
- `reports real permission states and never leaks a session on denial`.
- `reports a failed start with its reason`.
- `survives a UI reload in audio-window mode and dies with it in renderer
  mode`: the audio-window session id is unchanged after the reload and the
  renderer session is stopped with the reason recorded.
- `keeps the feature stream bounded and latest-wins`: 3 received, 2
  superseded, `latest()` returns the newest once and then null.
- `recommends a loopback device for capturing the DJ output`.

## Delete test

- Remove the `session !== null` early return in `start` and the one-context
  and one-permission assertions go red.
- Remove the same guard in `stop` (or make it stop twice) and the stop count
  goes red.
- Return `audio: true` from `captureConstraints` unconditionally and the
  exact-device assertion goes red.
- Stop the session in `onUiReload` regardless of host and the audio-window
  reload assertions go red.

## Remaining seams

- The hidden window itself is created by the app's main process, which
  implements `CapturePlatform` (start / stop / devices / permission); the
  existing `registerAudioWindow` hook in `apps/desktop/electron/main.ts` is
  where the window's URL is registered.
- The E2E reload check against the real Electron app belongs to the app E2E
  suite; this evidence covers the host logic it drives.
- The feature stream feeds the show host through the T-AUD-04 alignment.
