# T-ARC-02: Typed IPC API

Closes F-APP-04, F-APP-05, F-APP-06. Contributes to T-TRU-03 (no echo IPC).

## What was wrong

- 15 of 23 IPC channels validated and echoed: `ipcMain.handle(ch, (_e, payload) => schema.parse(payload))`.
- Preload exposed generic `invoke(channel, payload)`.
- Eight "real" handlers bypassed schema validation with casts.
- Handlers registered after `win.loadFile`, racing first renderer requests.
- Renderer `invoke` swallowed every error with `.catch(() => undefined)`.

## What changed

- New `packages/ipc` (`@autolight/ipc`): every channel has request schema,
  response schema with `{ ok: true, ... } | { ok: false, error }`, version,
  handler signature. `channelNames()` enumerates all 24 channels for the
  T-TRU-03 side-effect test. `callChannel` validates both directions and
  throws typed errors.
- `electron/ipc.ts` rebuilt: 24 handlers, each mapped to a real
  show-service function that mutates or reads authoritative state and records
  into the session recorder. Responses validate before return. Sender frame
  checked (file:// or localhost:5173 only). Errors return typed
  `{ ok: false, error }`.
- `electron/preload.ts` exposes a Proxy of named channel functions; unknown
  channels throw; requests and responses validate.
- `electron/main.ts` calls `createIpc()` before creating the window.
- `show-service.ts`: 16 new real handlers (master blackout/full/freeze/
  intensity/resume, follow mode, style, energy, build/drop triggers,
  show state, venue list/color/device-action, simulator mode). `show/live`
  returns honest empty `{ ok: true, decks: [], fixtures: [] }`.
  `pollAxCommand`, `scanLanCommand`, `identifyCommand`, `testChaseCommand`,
  `listAudioDevices`, `readAudioLevel`, `readDiagnostics` all return
  `{ ok: true, ... }` shapes matching the contract.
- Renderer `invoke` in `store.ts` surfaces errors into `diagnostics[ipc:...]`
  and returns null instead of swallowed undefined. All callers updated to
  read the `{ ok, ... }` envelope (resolve-live, venue, audio-sync,
  diagnostics, inspector).

## Proof

- `yarn workspace @autolight/ipc build` clean.
- `yarn workspace @autolight/ipc test`: 6 passed (contract: version on every
  channel, ok plus error shapes accepted, missing/mistyped rejected).
- `yarn workspace @autolight/desktop typecheck`: zero errors.
- `yarn workspace @autolight/desktop test`: 8 passed.
- `yarn workspace @autolight/desktop build`: clean.
- No `schema.parse(payload)` echo remains in `electron/ipc.ts`.
- No `.catch(() => undefined)` remains in renderer IPC paths.

## Delete test

Delete any handler in `electron/ipc.ts` and the `packages/ipc` contract test
plus the desktop typecheck go red (renderer callers reference the envelope).
Revert `show-service.ts` handlers to echoes and the response validation in
`createIpc` rejects them.

## Remaining work (not claimed done)

- T-TRU-03 integration test invoking every channel against a running app and
  asserting side effects (needs T-QA-02 harness).
- ast-grep `no-echo-ipc` and `no-string-ipc` rules (T-TRU-06).
- `show/live` backing from provider manager plus cache (T-LIVE-02, T-RUN-08).
