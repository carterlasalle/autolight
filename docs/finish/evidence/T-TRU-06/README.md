# T-TRU-06: Anti-pattern rule pack

Closes scars S1 to S28 mechanically where possible; F-APP-13, F-DOC-02, F-QA-14.

## Rules committed (tools/ast-grep/rules/, sgconfig.yml)

- `no-echo-ipc` (error): `ipcMain.handle(ch, (_e, p) => schema.parse(p))`.
  Count 0, blocking: T-ARC-02 deleted the pattern.
- `no-catch-undefined` (error): `.catch(() => undefined)`. Count 0, blocking.
- `no-tautological-expect` (error): `expect(true).toBe(true)`. Count 0, blocking.
- `no-golden-self-write` (error): `writeFileSync(golden, plan)` in tests.
  Count 0, blocking: only `scripts/golden-update.mjs` writes goldens.
- `no-child-process-in-hot-path` (error): `execFile` in sendToDevice/pushFrame.
  Count 1, ratchet: T-GOV-04 replaces with persistent sockets.
- `no-spawn-dev-tools` (error): spawn of node/python/npx. Count 1, same site.
- `no-string-ipc` (warning): string `invoke("...")` in renderer. Count 28,
  ratchet: migrate per task toward typed `callChannel`.

Dropped as non-AST-expressible (covered by grep checks instead): user paths
(`no-absolute-user-path`), relative runtime paths, env gates, unbounded
queues, empty catch, simulator imports, fixture fetches, literal UI metrics.
Each has a named owner task (T-TRU-02 bundle scan, T-CFG-04 magic numbers,
T-TRU-12 invariants).

## Forbidden words (tools/forbidden-words.mjs)

Scans production `packages/*/src`, desktop src plus electron, `analysis/src`
for TODO, FIXME, ponytail, stub, placeholder, mock, future, coming soon,
not yet, phase 2. Result: clean (0 hits). Fixed 7 hits: three ponytail
comments reworded to name their config keys, two mock-tracks comments,
one future title, one catalog receipt.

## Ratchet (tools/ratchet.json)

Per-rule counts recorded; errors block at zero, warnings ratchet down.
`yarn sg scan` exits nonzero on any error-level hit.

## Proof

- `yarn sg scan --config tools/ast-grep/sgconfig.yml`: 0 errors, 28 warnings.
- `node tools/forbidden-words.mjs`: clean.
- `node docs/finish/tools/check-coverage.mjs`: OK.

## Delete test

Reintroduce `expect(true).toBe(true)` in any test and the scan goes red.
Reintroduce an echo handler and `no-echo-ipc` fires.
