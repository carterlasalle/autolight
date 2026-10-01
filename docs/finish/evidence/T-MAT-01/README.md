# T-MAT-01: Matter controller process

Closes F-MAT-01 (controller part). Verified on the simulator only: no claim
is made about radio, commissioning hardware, or matter.js behaviour.
Simulator runs prove code, never hardware.

## What was built

- `packages/matter/src/controller.ts` (new): the `MatterAdapter` contract the
  Electron utility process must implement, plus `InMemoryAdapter`, the
  implementation every Matter probe drives in CI.
  - `classifyPairingCode`: manual codes are 11 digits (spaces and dashes
    ignored); QR payloads start with `MT:`; anything else is null, never a
    guess. Multi-admin is provenance declared by the caller, not a format.
  - `commission` rejects junk with typed `MatterError("bad-pairing-code")`,
    refuses all work after `close()` with `"stopped"`, and records
    `pairingKind`, `commissionedVia` (manual entry vs camera scan) and
    `multiAdmin` per node. Node ids increment from 1.
  - `command` throws `"unknown-node"` for a node that was never commissioned
    and applies OnOff, LevelControl and ColorControl writes to readable node
    state in call order. `read` serves the Basic Information cluster
    (vendorId, productId) and null otherwise, never a fabricated value.
  - The production controller (utility process, own storage directory,
    safeStorage wrapped fabric credentials) is packaging work outside this
    slice. This contract is the seam it will implement. matter.js
    (`@matter/main`) is deliberately NOT a dependency yet, so there is no
    version to pin and no dead import. Selecting switch option
    `matter-basic` (DS-31, key `govee.device.<fixtureId>.transportMode`)
    routes whole-fixture frames through this adapter; the failover slice
    (T-FOV-01) owns that wiring.
- `packages/matter/src/index.ts` (new): package exports.
- `packages/matter/package.json`, `tsconfig.json`, `vitest.config.ts`
  (new): standard workspace scaffolding matching `@autolight/simulator`.

## What passes today vs what waits

- Passes today: 10 tests in `packages/matter/src/controller.test.ts`:
  pairing classification (manual with dashes/spaces, QR payload, junk
  rejected), direct vs multi-admin commission, typed rejection of a bad
  code, stopped controller refusal, ordered command application, Basic
  Information reads, and unknown-node errors on command and read.
- Waits on hardware: commissioning a real device over the network with a
  pairing code or QR payload, multi-admin codes from Apple Home, Google
  Home or SmartThings, and the HW runbook for an owner Govee device that
  supports Matter (support detected from the device Matter QR, cloud
  metadata, or product documentation, never assumed by SKU).
- Waits on packaging: the Electron utility process with its own storage
  directory and safeStorage wrapped fabric credentials, and the matter.js
  adapter implementing `MatterAdapter`.

## Proof

- `vitest run --root packages/matter`: 4 files, 26 tests passed (see
  `green-run.txt`).
- `tsc --noEmit -p packages/matter/tsconfig.json`: clean.
- Red run: replacing `MatterError` with plain `Error` in `controller.ts`
  fails 3 tests (`red-run.txt`: bad-pairing-code, stopped, unknown-node).
  The typed-reason contract is what the tests pin, not the message text.

## Delete test

Delete `packages/matter/src/controller.ts` and `controller.test.ts` fails
to import. Remove the `classifyPairingCode` null branch and the junk
rejection tests go red. Remove the closed guard in `commission` and the
stopped test goes red.

## Remaining seams

- No matter.js dependency until the utility-process adapter lands; the
  in-memory adapter is the only `MatterAdapter` today.
- Fabric credential encryption (safeStorage keys from main) belongs to the
  utility process, not this package.
- Per-device switch wiring (`matter-basic` selectable, effective transport
  shown) belongs to T-FOV-01.
