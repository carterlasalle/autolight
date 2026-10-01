# T-TRU-03: No echo IPC

Closes F-APP-04. Spec: `wp00-truth-and-gates.md` T-TRU-03 (every channel
covered; `no-echo-ipc` rule at blocking).

## What changed

- `apps/desktop/src/app/services.test.ts`: new `describe` block "ipc
  handlers have real effects (T-TRU-03)" driving every one of the 30 typed
  channels through the production dispatch path (`IpcRouter` with a recording
  port) and asserting a channel-specific observable effect or authoritative
  read after each call:
  - master blackout/full/freeze/intensity/resume read `svc.overrides`;
  - show style/energy read director state; trigger-build/drop record;
    show/state echoes only the requested deck number against honest-empty
    live state (T-LIVE-02, T-RUN-08 own the backing);
  - follow/mode writes `followMode`; follow/ax returns stubbed provider
    readings (deck 1 readable, deck 2 denied);
  - venue/set-color, simulator/mode write service state;
  - venue/scan, identify, test-chase, device-action run against a loopback
    `GoveeLanSim` via scan-list-only discovery (no LAN touched): the
    discovered MAC, the device-IP entry and the action receipt are asserted;
  - venue/list reads the same non-empty registry snapshot;
  - audio/devices and audio/level assert the documented honest-empty shapes;
  - diagnostics/get echoes only the requested tab name (a read, not a write);
    diagnostics/all returns the diagnostics object;
  - config get/set/reset/export/import/schema round-trip through the
    file-owning `ConfigService` (temp file), including layer transitions.
  - A channel-count assertion guards against a new channel landing without a
    side-effect row.
- `apps/desktop/electron/services/provider-manager.ts`: added
  `resetProviderManagerForTest()` so the follow/ax row owns its stubbed
  readers (mirrors `resetConfigServiceForTest`).

## Proof

- `yarn workspace @autolight/desktop test src/app/services.test.ts`: 17
  passed (16 existing plus the T-TRU-03 matrix).
- `yarn workspace @autolight/desktop test`: 9 files, 60 passed.
- `yarn workspace @autolight/desktop typecheck`: zero errors.
- `tools/ratchet.json` already records `no-echo-ipc` at count 0, blocking;
  the rule stays green because no handler matches the echo pattern.
- Channel coverage script: 30/30 contract channels exercised in the test.

## Delete test

- Delete any `call(...)` row and the channel-count assertion still passes but
  that channel loses its side-effect proof; revert a handler to
  `schema.parse(payload)` and its row goes red (state never moves) plus the
  `no-echo-ipc` rule fires.
- Remove `resetProviderManagerForTest` and the follow/ax row reads the real
  osascript poller instead of the stub.

## Remaining seams (not claimed done)

- `show/live` returns honest empty until T-LIVE-02/T-RUN-08 land; the row
  asserts exactly that contract.
- show-service owns a separate `PersistentConfigStore` from ConfigService
  (T-CFG-02); the test seeds both and notes the split. Unifying them is a
  later task, not this one.
- `venue/scan` collects for a fixed 1500 ms; the row inherits that timing.
