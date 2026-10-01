# T-SEC-03: Electron hardening

Closes F-SEC-01, F-APP-05 (security part). Probes P-132/P-133/P-87 and
the delete test below are the acceptance evidence.

## What was wrong

- `BrowserWindow` was created with `contextIsolation: true` and
  `nodeIntegration: false` but without `sandbox: true`, without
  `webSecurity` stated, with no Content Security Policy, no
  navigation or new-window guards, and no permission handlers. A
  compromised renderer could navigate anywhere, open popups, request any
  permission, and load remote scripts.

## What changed

- `electron/main.ts` exports `securitySettings(preloadPath)` (pure,
  testable) and `createWindow()` consumes every field, so the checklist
  test goes red if any setting stops being applied:
  - `webPreferences`: `contextIsolation: true`, `sandbox: true`,
    `nodeIntegration: false`, `webSecurity: true`.
  - Strict CSP (no remote scripts, no `eval`): `script-src 'self'`,
    no `unsafe-eval` anywhere, no remote URLs outside dev-only
    `connect-src` (Vite HMR); `object-src 'none'`,
    `frame-ancestors 'none'`. Injected on frame-document response
    headers; remote `script`/`worker` fetches are cancelled at the
    network layer.
  - Navigation guard twice: session `onBeforeRequest` (only file://,
    localhost:5173, devtools:// navigate top-level) plus a
    window-level `will-navigate` guard reading the URL off the event
    object.
  - New-window guard: `setWindowOpenHandler` denies every popup.
  - `setPermissionRequestHandler` and `setPermissionCheckHandler` both
    installed with Electron 41 callback signatures. `media` granted only
    to the registered audio window (`registerAudioWindow` /
    `isAudioWindow`; denied everywhere until T-AUD-01 creates the DS-14
    DSP window), `midi`/`midiSysex` granted only to app windows,
    everything else denied.
- Preload is read-only for this task and unchanged: typed named API from
  `packages/ipc` only (no generic `invoke(channel)`); unknown channels
  throw `unknown-channel`. Main still verifies the sender frame for every
  message (`senderAllowed` in `electron/ipc.ts`, untouched).

## Proof

- `yarn --cwd apps/desktop exec tsc --noEmit -p tsconfig.json`: clean.
- `node scripts/build-main.mjs`: bundles `dist/electron/main.cjs`.
- Built-bundle probe (electron stubbed, `boot()` skipped): 12/12
  checklist assertions pass (sandbox, context isolation, no node
  integration, web security, `script-src 'self'`, no `unsafe-eval`,
  no remote scripts, app-only navigation, no new windows, 11 startup
  stages, 8 shutdown steps, media denied by default).
- New `src/electron/security.test.ts` (collected by vitest) asserts each setting from the built
  main module exports (P-87 probe: a renderer script cannot call an
  unknown channel, enforced by the preload proxy plus per-message sender
  check; P-132/P-133 wire the hardened window into the lifecycle).

## Delete test

Remove `sandbox: true`, the CSP injection, either navigation guard, the
new-window deny, or either permission handler in `main.ts` and
`src/electron/security.test.ts` goes red (each guard has a matching
assertion; delete both together or not at all). Revert preload to a
generic `invoke(channel)` and the `unknown-channel` throw plus the
sender check reject it. Relax `senderAllowed` and P-87 goes red.

## Remaining work (not claimed done)

- The DS-14 hidden audio window itself (T-AUD-01) registers its URL via
  `registerAudioWindow`; until then mic/audio-capture stays denied.
- `shell.openExternal` allowlist for docs links (no intent channel yet;
  all popups denied).
- Packaged-build E2E running the checklist inside real Electron (the
  probe above runs against the built bundle with electron stubbed).
