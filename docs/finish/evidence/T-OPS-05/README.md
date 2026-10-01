# T-OPS-05: Packaging and the development launcher

Closes F-OPS-05, F-OPS-10, F-APP-16, F-ANA-22 (packaging), F-ANA-29
(packaging); wp14 section T-OPS-05; DS-30 (electron-builder, ADR-006).

## What changed

Nothing new in this slice: the pieces this task requires already exist
and are wired, so the work was verification, not new code.

- Development launcher: `yarn dev` (root) runs
  `yarn workspace @autolight/desktop dev`, which runs Vite; main plus
  preload compile in watch mode via `node scripts/build-main.mjs --watch`
  and the matching preload script (`apps/desktop/scripts/`). One command
  starts the renderer, the main bundle and the show host path.
- Packaging record: DS-30 is decided (electron-builder, build-time only,
  `packages/config/src/decisions.ts` plus T-CFG-06 evidence). The macOS
  Info.plist keys, hardened-runtime entitlements, Windows NSIS notes, the
  `asarUnpack` native list, bundled uv plus pinned Python plus FFmpeg, and
  the unsigned-CI plus signed-pipeline split are all specified in wp14
  section T-OPS-05; no builder config exists in the tree yet, which is
  stated here instead of claimed.
- Native-module status: `better-sqlite3` plus `kysely` are not installed
  in this environment (T-DATA-01 evidence); the storage driver reports
  the node:sqlite fallback with its reason, which is what a packaged
  build must not do silently.

## Proof

- `ls apps/desktop/scripts/`: `build-main.mjs`, `build-preload.mjs`.
- `yarn workspace @autolight/desktop exec vite --version` (or the dev
  script presence): Vite 8 present via `apps/desktop/package.json`.
- `yarn workspace @autolight/storage run test`: 10 files, 73 tests passed
  (driver parity path exercised on the fallback driver).
- Installers do not build in this environment: there is no
  electron-builder config or builder dependency in the tree, and no
  native rebuild. Claiming installers build would be false; the build
  step is recorded as remaining work below.

## Delete test

Not applicable: no new module. If the dev scripts are removed,
`yarn workspace @autolight/desktop build` fails; if DS-30 is removed
from decisions, the T-CFG-06 decision test fails.

## Remaining work (not claimed done)

- Add the electron-builder config (macOS arm64 plus x64 or universal dmg
  plus zip; Windows NSIS x64 plus arm64 where native modules build),
  `extendInfo` plist entries, entitlements, `asarUnpack` list, and the CI
  package plus smoke-install jobs (T-TRU-11, T-OPS-06). That config plus
  a CI run that produces both artifacts turns this task green.
