# T-CFG-02: Layered config resolution and persistence

Closes F-CFG-02, F-DATA-08 (persistence and events part).

## What changed

- New `packages/config/src/store.ts`: `PersistentConfigStore extends ConfigStore` with a JSON file driver. The file path is injected through the constructor (production passes the userData path); no path is hardcoded. Only `app`, `venue`, `device`, `style` layers persist; `session` stays in memory as temporary Live state. Corrupt files, missing files, and unknown keys load as empty rather than throwing.
- `validateImportValues()` rejects invalid imports naming every bad key with the received value, the allowed range or type from the registry, and the fix. Range check parses registry `min to max` strings (for example `runtime.clock.tickHz` reports `allowed range 30 to 120 Hz`).
- Change events: `subscribe()` plus emit on `set`, `reset`, and `importJson` with a `ConfigChange` diff (`key`, `scope`, effective `layer`, `before`, `after`, `liveSafe`). `CONFIG_CHANGED` exports the `config:changed` event name.
- `packages/ipc/src/index.ts`: six channels following the existing table pattern (request schema, response schema, version): `config/get`, `config/set`, `config/reset`, `config/export`, `config/import`, `config/schema`. Schema channel exposes per-key `type`, `scope`, `unit`, `range`, `liveSafe` metadata.
- `packages/config/src/index.test.ts`: four new tests (persistence round trip, invalid import naming, live-safe metadata, change events). Existing five tests untouched.

## Proof

- `vitest run src/index.test.ts` in `packages/config`: 9 passed.
- `vitest run src/index.test.ts` in `packages/ipc`: 3 passed (generic contract tests cover all 30 channels including the 6 new ones).
- `tsc --noEmit` in `packages/ipc`: clean. Config package `tsc` reports only pre-existing missing `@types/node` noise also present on sibling packages before this change.
- Simulator runs prove code, never hardware; no hardware claim made.

## Delete test

Delete `packages/config/src/store.ts` and the `config persistence (T-CFG-02)` describe block goes red: specifically `device-scope value persists across re-instantiation and wins over app` (no file driver left to round trip layers). Delete the `config/*` entries from the IPC channel table and the IPC contract tests plus any renderer caller go red.

## Remaining work (not claimed done)

- Desktop handler wiring for the six `config/*` channels in `apps/desktop/electron/ipc.ts` (flagged to Main; outside owned paths). Until that lands, desktop typecheck is red on the exhaustive `handlers` map.
