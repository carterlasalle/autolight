# T-OPS-05: Packaging and the development launcher

Closes F-OPS-05, F-OPS-10, F-APP-16, F-ANA-22 (packaging), F-ANA-29
(packaging); wp14 section T-OPS-05; DS-30 (electron-builder, ADR-006).

## What changed

Shipped the builder config, vendor sidecars, package scripts, and CI jobs;
the unsigned artifacts build on both platforms (run 37390046174).

- Development launcher: `yarn dev` (root) runs
  `yarn workspace @autolight/desktop dev`, which runs Vite; main plus
  preload compile in watch mode via `node scripts/build-main.mjs --watch`
  and the matching preload script (`apps/desktop/scripts/`). One command
  starts the renderer, the main bundle and the show host path.
- Builder config `apps/desktop/electron-builder.cjs` (new): macOS arm64 plus
  x64 dmg plus zip, Windows NSIS x64 plus arm64; pinned
  `electronVersion: 41.10.6`; `extraResources` vendor manifests plus the
  analysis project; `asarUnpack` for `**/*.node`, govee-toolkit,
  better-sqlite3-multiple-ciphers, `@julusian/midi`, `@parcel/watcher`.
  Unsigned in CI per OD-06 (`publish: null`).
- macOS `build/entitlements.mac.plist` (allow-jit, audio-input,
  apple-events; unsandboxed, so no App Sandbox entitlements) plus
  `extendInfo` LAN/Bonjour/BLE/mic strings; Windows `build/installer.nsh`
  finish-page notes for UDP 4001 to 4003 plus privacy settings (T-SEC-02).
- Vendor sidecars `apps/desktop/scripts/fetch-vendor.mjs` (new): pinned
  CPython 3.12.7 via `uv python install`, per-platform FFmpeg URLs,
  manifest per `vendor/<platform>/`. Weights never bundled (OD-09).
- Scripts `fetch-vendor`, `dist:package`, `dist:package:dir`; `main` field
  at `dist/electron/main.cjs`; `electron-builder@26` root devDependency.
- CI `package` matrix (mac-arm64, win-x64) plus `smoke-install` matrix
  (bash shell on all OSes).
- Native-module status: `better-sqlite3` plus `kysely` are not installed
  in this environment (T-DATA-01 evidence); the storage driver reports
  the node:sqlite fallback with its reason, which is what a packaged
  build must not do silently.

## Proof

- Local `--dir` build: `Autolight.app` bundles with `analysis/` plus
  `vendor/` resources and unpacked `.node` binaries; asar sanity passes.
- CI run 37391824513: every job success: `package` mac-arm64 plus win-x64,
  `smoke-install` mac plus win, all three e2e legs, conformance, and every
  gate above. First fully green run including installers.

## Delete test

Delete `electron-builder.cjs` and the `package` job fails naming T-OPS-05.
Remove a vendor manifest and the builder warns the resource is missing.

## Remaining work (not claimed done)

- Signed pipeline runs as soon as Apple/Windows credentials exist (OD-06).
