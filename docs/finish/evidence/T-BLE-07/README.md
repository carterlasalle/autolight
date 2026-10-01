# T-BLE-07: Encrypted link (DS-05)

Closes F-BLE-01, F-BLE-02 (encoded-link flag and handshake), F-BLE-06, F-SEC-04. Spec: WP04 T-BLE-07.

## What changed

- `packages/ble/src/encrypted.ts` (additive): DS-05 session behind `govee.ble.encryptedLink` (off/on/auto detection already in `encryptedLinkNeed`). Local `encodeBleHandshake` (20-byte E7 frames, XOR) so the shared T-BLE-04 codec stays untouched, toolkit `E7 01` / `E7 02` seed frames, v2 `E7 11 01` nonce frame, AES-GCM via node:crypto (`bleV2Encrypt` / `bleV2Decrypt`, 16-byte tag always; non-16-byte tags rejected before decrypt because the device silently ignores a 12-byte tag), `verifyBleV2Reply` (decrypted reply must carry the device SKU and MAC), `requireOwnerKeyDecision` (undecided throws `BLE_KEYS_NEEDED_COPY`), `parseBleKeysFile` / `loadBleKeysFile` (owner-provided local JSON `{ version: 1, keyHex }`, 16 or 32 bytes; errors name the field, never the value). Provenance header cites govee-homeassistant ble_packet.py / ble_crypto.py (MIT, lasswellt/govee-homeassistant) and toolkit ble.md. No vendor key in repo, docs, logs or tests; tests mint random keys.
- `packages/ble/src/sim.ts` addition: a local `decodeHandshakeFrame` answers E7 without touching the shared codec.
- `packages/ble/src/encrypted.test.ts` (new): 6 tests. Handshake byte shapes, GCM round trip plus 12-byte rejection plus tamper plus IV/key length guards, SKU/MAC reply check, owner decision gate, key file parse/load with bad shapes, DS-05 mode selection plus both handshakes answered on the sim.

## Proof (scoped, mid-flight allowed)

- `yarn workspace @autolight/ble test src/encrypted.test.ts`: 6 passed.
- `yarn workspace @autolight/ble test` (full): 10 files, 59 tests passed.
- `yarn workspace @autolight/ble typecheck`: clean.

## Delete test

Delete `encodeBleHandshake`: encrypted tests fail to import and the sim answers no handshake. Accept a 12-byte tag in `bleV2Decrypt` and the tag test goes red (expects a 16-byte RangeError). Return a path from `requireOwnerKeyDecision` when undecided and the gate test goes red (expects the keys-needed copy).

## Seams

- Detection (`encryptedLinkNeed`, `BLE_KEYS_NEEDED_COPY`) owned with T-BLE-04; extended additively.
- Sim handshake answers owned by T-BLE-09 sim; the wizard (T-BLE-06) records seed/v2/plain per unit.
- Owner decision: shipping vendor keys in the product is still an owner call (briefing section 7). Until decided, builds read the local file and Setup shows the keys-needed copy. No key material here.
