# T-ARC-05: Main services and layout

Closes F-APP-01, spec 83, spec 155.

## What changed

- `apps/desktop/electron/services/` now exists with one file per row of
  `04-target-architecture.md` section 1, each with `start()`, `stop()` and
  `status()` (the shared contract and the spec 132 state vocabulary live in
  `services/base.ts`: idle, starting, running, degraded(reason),
  failed(reason), stopped):
  config-service, storage-service, library-service, identity-service,
  analysis-supervisor, provider-manager, midi-service, matter-bridge,
  cloud-service, ipc-router, lifecycle.
- Moves out of the legacy files:
  - `electron/follow.ts` (1 Hz AX deck poller, PRO DJ LINK observe-only
    capture on :50001) moved into `services/provider-manager.ts` verbatim,
    keeping the 60 byte packet parse and the reusePort comment.
  - `electron/ipc.ts` (typed channel table, sender frame check, request and
    response validation) moved to `services/ipc-router.ts`. `main.ts` calls
    `createIpc()` from there.
  - `config/*` channels now route through `services/config-service.ts`, the
    single owner of the layer stack, the registry and the config file
    (`configGet/Set/Reset/Export/Import/Schema` semantics kept, including the
    typed `E_UNKNOWN_KEY`, `E_CONFIG_IMPORT` errors that name the key and the
    fix). Change events fire listeners and are counted.
  - `follow/ax` now routes to `provider-manager.pollOnce()`.
  - `services/lifecycle.ts` owns the startup stage machine (spec 132 stage
    names, status vocabulary, per stage timing, degraded stages do not stop
    the app), the shutdown runner (spec 133 order, per step timeout from the
    caller, a wedged step is logged and shutdown continues) and the crash
    policy order (record, hold last frame, restart show host, dim after
    `runtime.crash.holdMs`).
- Renderer layout per spec 83: `src/app` (entry, shell, store, resolve-live,
  shortcuts, tokens, utils, security checklist), `src/routes` (route table,
  exhaustive over the `Route` union), `src/components` (kit plus the shadcn
  `ui/` primitives), `src/features` (live, library, venue, inspector, setup,
  diagnostics, settings), `src/styles` (globals.css), and `src/index.html` as
  the Vite entry. `src/renderer` and `src/electron` are gone.
  Vite root, the `@` alias, both tsconfig path maps, `components.json`
  aliases, the two Knip entries and the three journey imports were updated in
  the same change.
- `vitest.config.ts` gained two aliases: `@` (the shared UI files import each
  other through `@/components/ui/*`, which no test could resolve before, so
  the shell and route tests would not load) and the workspace packages, which
  now resolve to `packages/*/src/index.ts` exactly as `vite.config.ts` and
  `scripts/build-main.mjs` already did. Tests therefore run the same code the
  app bundles instead of a package `dist` that a sibling may not have rebuilt.
- `services/storage-service.ts` is T-DATA-01's database owner, which a sibling
  landed in that file mid turn (driver policy, pragmas, migrations, and the
  same `name`, `start()`, `stop()`, `status()` contract through
  `openStorageService`). This slice keeps that implementation and exercises it
  from the same test file instead of restoring the earlier state machine.
- `electron/main.ts`: `boot()` only runs inside Electron now. Importing the
  module from the checklist tests used to reject on `app.whenReady` and the
  suite reported an unhandled rejection.
- `.dependency-cruiser.cjs`: the three existing rules plus seven ownership
  rules encoding section 1 (UI state, show clock, database, libraries, Python
  worker, Govee sockets, provider IO) and six spec 155 arrow rules
  (planner upstream only, runtime before mixer, mixer without transport,
  renderer to venue only, venue without transport, Govee is a sink). The file
  parses to 16 rules: 15 error, 1 warn.

## Proof

- `P-83-layout`, new probe in `apps/desktop/src/app/layout.test.ts`: service
  file list, the five spec 83 `src` directories, `src/index.html` present,
  no `src/renderer`, no `src/electron`, no `electron/follow.ts`, no
  `electron/ipc.ts`. Passes.
- `apps/desktop` suite (`vitest run` from `apps/desktop`, collected
  `src/**/*.test.ts`): 9 files, 59 tests, about 0.6 s.
  - `src/app/services.test.ts` (20 tests) exercises every service through its
    real lifecycle by importing the module. Real behavior asserted, not
    wiring: config set persists to the file and emits the change (layer app),
    unknown key is rejected; storage (T-DATA-01's owner in the same file)
    opens the DB file it owns, reports the driver line, schema version and
    table count, round trips a venue and closes; the library watcher batches
    two events into one debounce window and closes on stop; identity resolves
    `rb:42` and reports the
    second call as cached; the supervisor refuses before start, spawns lazily
    on the first job and stops the worker; provider-manager runs its poll loop
    on a fake clock, caches readable decks and takes a ProLink beat; MIDI
    degrades without a backend yet still classifies CC and note hints, and
    publishes backend messages when one is wired; the Matter bridge degrades
    unwired and restarts an injected controller on exit; cloud metadata is off
    by default, refuses without key or transport and has no frame surface;
    lifecycle walks the stage machine (degraded reason, ready, timing), keeps
    going after a wedged shutdown step and runs the crash policy in order;
    ipc-router registers all channels, denies a foreign sender, rejects an
    invalid request, and serves `config/schema` plus
    `config/get` through config-service.
  - `src/routes/routes.test.ts`: every route renders its own screen (marker
    per route), so a mis-wired or duplicated entry fails here.
  - `src/app/shell.test.ts`: the app frame renders with the default route.
- Import graph check over `apps/desktop/src`: 96 relative and `@/` imports in
  53 files all resolve to existing files (run after the move, one depth bug
  in the feature views was found and fixed this way).
- `node tools/forbidden-words.mjs`: clean.

## Dependency-cruiser state (inspected, not executed)

The slice was edit-only for this worker, so the rules were verified by
inspecting the real import graph rather than by running depcruise:

- Green by inspection: no package imports `apps/desktop`; no main module
  imports `packages/show-runtime`; only `services/storage-service.ts` imports
  `packages/storage`; only `services/analysis-supervisor.ts` imports
  `packages/analysis-client`; `node:dgram` is imported only by
  `electron/govee-lan.ts` and `services/provider-manager.ts`;
  planner, runtime, mixer, renderer, venue and govee import contracts,
  dj-core and venue only, as spec 155 requires.
- `ownership-provider-io-main-only` is severity `warn` and has one known
  violation: `src/features/live/live.ts` and `src/app/resolve-live.ts` still
  import the provider packages. That is the F-APP-02 spine violation recorded
  in `T-TRU-04`, closed by T-RUN-08 and T-REND-01. It stays a warning so CI is
  green while the boundary is already encoded.
- The BLE row of the ownership table has no rule yet: there is no BLE backend
  dependency to constrain until T-BLE-01 lands. Add the rule with the
  dependency.

## Deferred, in flight with a sibling (not silently dropped)

`electron/show-service.ts` and `electron/govee-lan.ts` are still in the tree.
`GoveeLifecycle` held a rewrite of both files (T-GOV-04 to T-GOV-09) in
flight and asked for a hold, because deleting them mid rewrite discards that
work. The non Govee logic already lives in the new services and
`services/ipc-router.ts` points at them, so the remaining cutover is small:
delete the two files once T-GOV lands, move the govee wrappers to
`services/govee-transport.ts` (or into the show host govee-manager, which the
ownership table gives the sockets to), and repoint the `show/*`,
`master/*`, `venue/*` and diagnostics handlers of `services/ipc-router.ts` at
the services that now own them.

## Follow-ups this slice did not take

- Stale path mentions of `apps/desktop/src/renderer/` remain in `README.md`
  (capability table row) and in older `docs/finish` pages plus
  `.bughunt/generated/capabilities.json`. `capabilities.yaml` itself was
  updated to `apps/desktop/src/`; the rest belongs to the documentation and
  generation tasks.
- `services/ipc-router.ts` still imports the `show/*`, `master/*`, `venue/*`
  and diagnostics handlers from `show-service.ts`. They move when that file
  is deleted with the T-GOV cutover above.

## Delete test

- Delete any file in `electron/services/` and `P-83-layout`
  (`src/app/layout.test.ts`) goes red.
- Break a service transition (for example let `stop()` leave
  `counters.watchers` non-zero, or let config set skip persistence) and the
  matching `services.test.ts` assertions fail; the file imports all eleven
  services, so a missing module is an immediate collection failure.
- Delete an entry from `SCREENS` in `src/routes/index.tsx` and the typecheck
  fails (`Record<Route, ...>` is exhaustive); point a route at the wrong
  screen and `routes.test.ts` fails on the marker.
- Move the config handlers in `services/ipc-router.ts` back to the old file
  and the `config/schema` and `config/get` assertions in
  `services.test.ts` fail.
- Restore `void boot()` in `electron/main.ts` and the desktop suite reports
  the `app.whenReady` unhandled rejection again.
