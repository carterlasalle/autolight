# T-GOV-18: ptReal scenes over LAN

Closes F-GOV-27. Spec 133 ending look option "scene". Provenance:
wez/govee2mqtt `lan_api.rs:188-250` (base64 BLE-format packets inside the
LAN JSON `ptReal` command) via docs/research/prior-art-reuse.md.

## What was built

- `packages/govee/src/scenes.ts` (new): `ptRealCommand()` builds
  `{"msg":{"cmd":"ptReal","data":{"command":[...]}}}`,
  `parsePtRealCommand()` parses it back, `sceneFromCatalog()` /
  `listScenes()` read a cloud or stored catalogue, and `sceneCommand()`
  resolves a scene name for a setup, idle or ending moment to the LAN
  datagram (unknown names fail with the catalogue source and the moment).
  Never used for show frames: no "show" moment exists.
- Re-exported from `packages/govee/src/index.ts`.

## What passes today vs what waits

- Passes today: 4 tests in `packages/govee/src/scenes.test.ts`
  (envelope round-trip; non-ptReal and empty packets rejected; catalogue
  sorted with copies; ending-look datagram plus a named unknown scene).
- Waits on hardware: `HW-GOV-07` (the owner applies a scene as an idle
  and ending look and confirms the unit renders it); waits on the cloud
  slice for the cloud catalogue (T-CLD-01).

## Proof

- `yarn workspace @autolight/govee vitest run src/scenes.test.ts` :
  4 tests passed; full govee slice run : 40 tests passed.
- `yarn workspace @autolight/govee tsc --noEmit -p tsconfig.json` : clean.
- Red run: change the cmd string and the round-trip test goes red; return
  a scene for an unknown name and the error test goes red.

## Delete test

Delete `packages/govee/src/scenes.ts` and every scenes test fails to
import. Remove the empty-command rejection and the parse test goes red.
