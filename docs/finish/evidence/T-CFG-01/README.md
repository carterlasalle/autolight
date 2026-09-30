# T-CFG-01: Create `@autolight/config`

Closes F-CFG-02, F-DATA-08 (registry part).

## What changed

- New `packages/config` (`@autolight/config`) with `defineKey()`, typed
  accessors, JSON Schema export, markdown export, JSON defaults for Python.
- All 240 catalog keys from `docs/finish/03-config-and-decisions.md` section 3
  exist in the registry with stated default, unit, range, receipt, liveSafe,
  and scope.
- `yarn workspace @autolight/config run export` regenerates
  `packages/config/src/registry.ts`, `docs/config-reference.md`, and
  `analysis/src/autolight_analysis/config_schema.json` plus
  `config_defaults.json` from the catalog. The registry file header says
  do-not-hand-edit.
- Type test: `defineKey("nope.missing")` throws `unknown-config-key`.

## Proof

- `yarn workspace @autolight/config build` clean.
- `yarn workspace @autolight/config test`: 10 passed (240 keys with receipts,
  unknown-key rejection, layered resolution, invalid import naming bad keys,
  export/import round trip).
- `node packages/config/scripts/export.mjs` prints `240 keys` and rewrites all
  four artifacts byte-identically when rerun.
- `check-coverage.mjs` reports 240 config keys (was failing on 11 wildcard
  references before the tool fix in the same session).

## Delete test

Delete any key from the catalog and rerun export: the registry shrinks to 239
and the count test goes red. Delete `defineKey` and every consumer typecheck
goes red.
