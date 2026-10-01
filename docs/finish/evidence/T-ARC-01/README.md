# T-ARC-01: Show host with all DS-07 modes

Closes F-APP-02 (with T-RUN-01), spec 56, 86, 108.

## What changed

- New `packages/show-host`: one 60 Hz hrtime tick pipeline (deck worlds
  with latest-wins DeckState ingest, estimator, cursor, overrides, mixer,
  renderer, snapshot publisher at `runtime.snapshot.uiRateHz` latest-wins)
  communicating over MessagePort with the typed protocol from
  `packages/ipc`. Same entry runs in three DS-07 modes (worker-thread,
  utility-process, utility-process-worker).
- Native addon probing per mode (govee-toolkit napi, both BLE backends):
  a mode whose addons cannot load reports `unavailable` with the reason;
  `startHost` throws instead of silently falling back.
- Fixed in integration: `startHost` now forwards its probe into the inner
  `ShowHost` (previously the inner host re-probed with the default probe
  and threw even when the caller allowed the mode); `exactOptionalPropertyTypes`
  call-site fixes; `requireFn` to `requireNativeAddon` typo fix.

## Proof

- `yarn workspace @autolight/show-host build`: clean.
- `yarn workspace @autolight/show-host typecheck`: clean.
- `yarn workspace @autolight/show-host test`: 4 passed (mode probing with
  unavailable reasons, tick plus snapshot within maxBytes, supervised port
  close fires the crash hook exactly once, MessagePort chain survives
  without the renderer).
- Jitter measurement per mode under the three T-ARC-01 loads belongs to
  T-ARC-06; renderer-kill survival belongs to the T-QA-02 harness.

## Delete test

Delete the probe forwarding in `startHost` and the chain test throws
`unavailable` (reproduced in this session). Delete any DS-07 mode from
`HOST_MODES` and the mode test goes red.
