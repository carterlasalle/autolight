# Anti-slop provenance

Source: `dmmulroy/anti-slop`, skill `install-anti-slop` (via `skills-lock.json`
computedHash `4031728fbe75bdcad6ee3208fd52b5d66e167b056fefee1fa9758e9a6cb9c0c8`).

Installed paths:

- `tools/oxlint/anti-slop/` — vendored generic plugin (copied by the skill's
  `scripts/install.mjs`; includes nested `vendor/eslint-stylistic/LICENSE`
  plus its own `UPSTREAM.md`).
- `.oxlintrc.json` — registers the `anti-slop` jsPlugin plus all generic rules
  at `error` with the native `oxc/no-accumulating-spread` companion.

Intentional deviations:

- No Effect plugin: no direct `effect` dependency in any package manifest.
- Added `.codex/**` plus `.omp/**` to `ignorePatterns` alongside the skill's
  agent-tooling ignores.

Verification status (2026-10-06, commits cc9e078 plus ab3bd45): bare
`oxlint` exits 1 with 8430 anti-slop errors — mostly
`require-readable-spacing`, `require-safety-comment-for-type-assertion`,
`no-runtime-typeof` (272), `no-unsafe-dictionary-type` (86),
`no-conditional-empty-object-spread` (83) — plus `yarn lint` (the repo's
workspace typecheck gate) exits 0. No application cleanup applied:
findings reported only, per the skill's no-unsupervised-migration rule.
