# T-TRU-17: Toolchain facts

Closes F-OPS-07.

## What changed

- Root `package.json` gains `"engines": { "node": ">=22.12" }` (built with
  22.22.2 locally; CI pins 22).
- Root scripts: `dev` (Vite plus Electron with the show host, via the desktop
  workspace), `truth` plus alias `audit:truth` (coverage tool, capability
  manifest check, claim check, forbidden words, ast-grep scan), `verify:all`
  (everything CI runs locally: build, typecheck, vitest, pytest, e2e),
  `golden:update` (deliberate golden writer).
- Electron bundles its own Node version, distinct from the dev `engines`
  floor; `app.environment` reports both at runtime (T-ARC-05 owns the surface,
  recorded here as intent).

## Proof

- `node --version`: v22.22.2. `yarn --version`: 4.9.2.
- `yarn truth` runs all five gates (verified below in T-TRU-01 evidence).
- README quickstart (`yarn install --immutable`, `yarn build`, `yarn test`)
  runs as written; `yarn dev` starts the renderer.

## Delete test

Remove `engines` and Yarn warns on install with Node 22 floor missing.
Remove any script and its gate stops running.
