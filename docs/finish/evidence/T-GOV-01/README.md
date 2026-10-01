# T-GOV-01: Bring in govee-toolkit

Closes F-GOV-01, spec 44. Verified on the simulator only: no claim is made
about hardware. Simulator runs prove code, never hardware.

## What was built

- `packages/govee/src/engines/toolkit.ts` (new): `ToolkitEngine`, the
  `LanStreamEngine` wrapper around the govee-toolkit napi binding
  (`govee-toolkit` 0.5.0, MIT, Damien Thery, commit
  ceef296f6382881c5f07698d78fb5719ebca6686). The engine surface it drives is
  the pinned binding's own (`packages/node/binding.d.cts` upstream):
  `Govee.start()`, `Govee.scan()/devices()/device(id)`,
  `DeviceHandle.openStream(resolution, rate, gradient)`,
  `SegmentStream.setAll/zones/rateHz/framesSent/framesSuperseded/close`,
  `DeviceHandle.identify()/segment()/status()/health(mode)`.
- Typed unavailable reasons: every addon failure becomes
  `ToolkitUnavailableError` with `reasonClass` `load`, `context` or
  `platform`. `defaultToolkitLoader` resolves `govee-toolkit` (or
  `AUTOLIGHT_GOVEE_TOOLKIT_ENTRY` for a local build) through a runtime
  import, validates the module shape (`Govee.start()` present), and throws the
  typed error otherwise. Nothing is retried and nothing is faked.
  `ToolkitEngine.report()` carries the reason to the device tile; a load
  failure is sticky so a show never re-probes mid-song.
- `ToolkitEngine.ensureLoad()` returns `{ ok }` or
  `{ ok: false, reasonClass, detail }` so DS-02 `auto` can pick an engine up
  front and record which load happened.
- Counters: `framesRequested` (accepted by the wrapper), `framesSent` and
  `framesSuperseded` (the binding's own), `rateHz`, `zones`, plus
  `loadedMs` and `openStreamMs` for the T-GOV-01 metrics line.
- `packages/govee/package.json`: `optionalDependencies` entry
  `govee-toolkit: 0.5.0` (exact version). Optional because the addon is a
  per-platform native artifact; the engine treats an absent artifact as a
  typed reason instead of an install error. `devDependencies` gained
  `@autolight/simulator` for the parity run. Both entries were added by hand:
  the orchestrator's `yarn install` links them and records them in
  `yarn.lock`.
- `packages/govee/src/index.ts`: re-exports the engine and its binding types,
  so hosts import them from `@autolight/govee`.
- `packages/govee/src/razer.ts` (new): the shared seam the wrapper needs
  (`LanStreamEngine`, `StreamOptions`, `EngineReport`, `SegmentStreamLike`),
  with the byte codec that was in `index.ts` (see T-GOV-02).

## What passes today vs what waits

- Passes today: the wrapper's binding translation, the typed load failure,
  the DS-02 wiring around it, and a binding-shaped instance driven by the
  simulator (see `docs/finish/evidence/T-GOV-03/README.md` for the parity
  and simulator receipts).
- Waits on the addon: `node_modules/govee-toolkit` is absent on this machine,
  so the real `dlopen` load, the per-host-mode load result, `P-44-toolkit-loaded`
  against the simulator, and the addon's own load and stream-open times need
  the dependency installed (`yarn install`) plus a rebuilt binding. The engine
  already reports those two numbers through `loadedMs` and `openStreamMs`;
  with the local loader they measure 0.13 ms (load) and 0.277 ms (stream open).
- Outside this slice's paths: `@electron/rebuild` or the prebuilt ABI match
  and `asarUnpack` for `**/*.node` belong to the desktop packaging config
  (`apps/desktop`); the `PIN.md` note describing how the dependency is
  consumed (optional dependency plus runtime import) belongs to
  `vendor/govee-toolkit/PIN.md`. Both remain with their owners.

## Metrics (stub binding, no hardware, no addon)

| Engine | Load | Stream open | Datagrams for 2 frames |
| --- | --- | --- | --- |
| toolkit | 0.13 ms (local loader) | 0.277 ms | 4 (arm, 2 paints, disarm) |
| native-ts | n/a (in process) | 0.712 ms | 4 (arm, 2 paints, disarm) |

Both rows produced byte-identical datagram sequences (`identicalBytes: true`).
The addon's real load and stream-open times are unmeasured until the artifact
is installed, and the evidence says so rather than guessing.

## Proof

- `vitest run --root packages/govee`: 1 file, 21 tests passed (see the
  T-GOV-03 README for the assertion list; this task's own tests are the typed
  load failure and the per-device fallback).
- `packages/govee/node_modules/.bin/tsc --noEmit -p tsconfig.json`: no output
  (clean).
- Load-failure receipt: `auto` with a loader that throws
  `dlopen(govee_toolkit.node): image not found` selects native-ts and the
  device decision reads `toolkit addon failed to load: dlopen(...)`; mode
  `toolkit` throws `ToolkitLoadFailure` carrying the same text instead of
  downgrading silently.

## Delete test (byte level)

Delete `packages/govee/src/engines/toolkit.ts` and `engines/index.ts` stops
compiling and the `auto`, `toolkit` and per-device fallback tests fail to
import. Make `resolutionFor()` return `"app"` for a numeric resolution and the
binding opens at its 14-zone default while the frames carry the qualified 4
zones, so the toolkit datagram array (its `B0` frames would say `nbSeg 14`
against the native `nbSeg 4`) no longer equals the native array and the parity
test goes red on the first `expect(toolkitSink.datagrams).toEqual(...)`.
Report `available: true` on a failed load and the `auto` fallback test loses
its typed reason. Drop the sticky `loadFailure` and a second device would
retry the broken addon mid-show instead of reading its recorded reason.
