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

Verification status: baseline `oxlint` reports ~8.3k findings (mostly
`require-readable-spacing` plus `require-safety-comment-for-type-assertion`
across existing source/tests). No cleanup applied — findings reported only,
per the skill's no-unsupervised-migration rule.
