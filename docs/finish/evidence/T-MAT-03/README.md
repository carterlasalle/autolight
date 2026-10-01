# T-MAT-03: Matter identity binding

Closes F-MAT-01 (binding part). Verified on the simulator only: no claim is
made about a physical device identity. Simulator runs prove code, never
hardware.

## What was built

- `packages/matter/src/binding.ts` (new): `bindNode` plus the
  `DeviceRecord` shape (`fixtureId`, `matterNodeId`, `vendorId`,
  `productId`, `multiAdmin`, `boundAtMs`). The store is a plain
  `Map<string, DeviceRecord>`: the binding table has no behaviour beyond
  get and set, so it needs no abstraction.
  - Vendor and product IDs come from the Basic Information cluster read,
    never from the pairing input. A node without that cluster throws
    `"unknown-node"` and binds nothing.
  - The flow sends an `identify/identify` flash first, then awaits the
    caller's `confirmIdentify`. A decline throws `"not-confirmed"` and
    saves nothing: never auto-merge.
  - An existing binding for the same fixture throws `"already-bound"`
    unless `allowRebind` is set, which the UI sets only behind a second
    confirmation.

## What passes today vs what waits

- Passes today: 4 tests in `packages/matter/src/binding.test.ts`:
  vendor/product recorded from Basic Information after a flash plus
  confirmation (flash counted once, binding persisted), decline saves
  nothing, rebind refused without `allowRebind` and honoured with it
  (multi-admin flag carried), and a ghost node rejected.
- Waits on hardware: the end to end binding flow against a real
  commissioned light with a user confirmed identify flash.

## Proof

- `vitest run --root packages/matter`: 4 files, 26 tests passed (see
  `green-run.txt`).
- `tsc --noEmit -p packages/matter/tsconfig.json`: clean.
- Red run: replacing `MatterError` with plain `Error` in `binding.ts`
  fails 2 tests (`red-run.txt`: not-confirmed, already-bound). The typed
  refusal contract is what the tests pin.

## Delete test

Delete `packages/matter/src/binding.ts` and `binding.test.ts` fails to
import. Remove the `confirmIdentify` gate and the decline test goes red.
Remove the `allowRebind` check and the already-bound test goes red.

## Remaining seams

- The confirmation UI (identify flash prompt, second confirmation for
  rebind) belongs to the device screen work.
- Persistence of the binding table across restarts belongs to the storage
  work; the Map is in memory today.
