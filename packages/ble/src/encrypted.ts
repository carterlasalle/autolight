// Encrypted link helpers (T-BLE-04 slice: detect only; T-BLE-07 owns keys).
//
// The advertisement flag bit 0x40 means encoded frames only (WP04). This
// module reads the flag and the version characteristic shape so DS-05 `auto`
// knows when a handshake is required. Key material and the AES-GCM session
// belong to T-BLE-07 and are not here: until the owner decides, keys come
// from a local file the owner provides and the UI shows that encrypted-link
// devices need keys.
import { createCipheriv, createDecipheriv } from "node:crypto";
import { readFile } from "node:fs/promises";
import { BLE_ENCODED_FLAG, BLE_FRAME_LEN, BLE_PAYLOAD_LEN, BLE_PROTYPE } from "./constants.js";

export type BleEncryptedMode = "off" | "on" | "auto";

export interface BleEncryptedNeed {
  encoded: boolean;
  protocolV2: boolean;
  /** True when the link must handshake before plain frames. */
  handshakeRequired: boolean;
  reason: string;
}

/** Decides whether a handshake is required from the advertisement flag and the version byte. */
export function encryptedLinkNeed(
  manufacturer: Uint8Array,
  versionByte: number | null,
  mode: BleEncryptedMode,
): BleEncryptedNeed {
  const encoded = manufacturer.length > 0 && ((manufacturer[0] ?? 0) & BLE_ENCODED_FLAG) === BLE_ENCODED_FLAG;
  const protocolV2 = versionByte === 2;
  if (mode === "off") {
    return { encoded, protocolV2, handshakeRequired: false, reason: "DS-05 off: plain frames only" };
  }
  if (mode === "on") {
    return { encoded, protocolV2, handshakeRequired: true, reason: "DS-05 on: always attempt the handshake" };
  }
  const handshakeRequired = encoded || protocolV2;
  return {
    encoded,
    protocolV2,
    handshakeRequired,
    reason: handshakeRequired
      ? "advertisement sets the encoded bit or the version characteristic reports v2"
      : "plain device: no encoded bit and no v2 version",
  };
}

/** UI copy for devices that need keys (WP04 T-BLE-07 note). */
export const BLE_KEYS_NEEDED_COPY = "encrypted-link devices need keys (see docs/troubleshooting.md)";

// ---------------------------------------------------------------------------
// Encrypted session DS-05 (T-BLE-07; provenance and key rule below)
// ---------------------------------------------------------------------------
//
// Provenance: WP04 T-BLE-07 cites govee-homeassistant
// custom_components/govee/api/ble_packet.py and ble_crypto.py (MIT,
// lasswellt/govee-homeassistant) and govee-toolkit docs/protocol/ble.md.
// No vendored copy exists in this repo, so the shapes below encode the WP04
// facts: the toolkit E7 01 / E7 02 session-seed handshake, the v2 version
// byte on characteristic ...2b12, the v2 handshake header E7 11 01, AES-GCM
// with a 16-byte tag (a 12-byte tag is silently ignored by the device), and
// a decrypted-reply check for the device SKU and MAC. node:crypto carries
// the AES-GCM itself; no crypto is hand rolled here.
//
// Key rule (WP04 briefing section 7, owner decision): the static keys are
// vendor constants and are never stored in this repo, never printed in docs
// and never logged. Until the owner decides, the build reads them from a
// local file the owner provides (parseBleKeysFile / loadBleKeysFile below)
// and the UI shows BLE_KEYS_NEEDED_COPY. Tests mint random keys in memory;
// no test vector contains a vendor key.

/** Header bytes of the v2 handshake payload: E7 11 01 then the nonce. */
export const BLE_V2_HANDSHAKE_CMD = 0x11;
export const BLE_V2_HANDSHAKE_MARK = 0x01;
/** GCM tag length the device accepts (WP04: 16 bytes, never 12). */
export const BLE_V2_TAG_LEN = 16;
/** GCM IV length in bytes. */
export const BLE_V2_IV_LEN = 12;

/**
 * Encodes a 20-byte E7 handshake frame: marker, cmd, seed or nonce payload
 * padded to byte 18, XOR of bytes 0 to 18. Local to this module so the
 * shared T-BLE-04 codec stays untouched.
 */
export function encodeBleHandshake(cmd: number, payload: Uint8Array = new Uint8Array(0)): Uint8Array {
  if (payload.length > BLE_PAYLOAD_LEN) {
    throw new RangeError(`BLE handshake payload needs at most ${BLE_PAYLOAD_LEN} bytes, got ${payload.length}`);
  }
  const out = new Uint8Array(BLE_FRAME_LEN);
  out[0] = BLE_PROTYPE.HANDSHAKE;
  out[1] = cmd & 0xff;
  out.set(payload, 2);
  let xor = 0;
  for (let i = 0; i < BLE_FRAME_LEN - 1; i++) xor ^= out[i] ?? 0;
  out[BLE_FRAME_LEN - 1] = xor & 0xff;
  return out;
}

/**
 * Toolkit session-seed handshake frames: E7 01 then E7 02 carrying the seed.
 * The seed is at most 17 bytes, the 20-byte frame payload ceiling.
 */
export function bleHandshakeSeedFrames(seed: Uint8Array): { e701: Uint8Array; e702: Uint8Array } {
  if (seed.length === 0 || seed.length > 17) {
    throw new RangeError(`handshake seed needs 1 to 17 bytes, got ${seed.length}`);
  }
  return {
    e701: encodeBleHandshake(0x01, seed),
    e702: encodeBleHandshake(0x02, seed),
  };
}

/**
 * v2 handshake frame: E7 11 01 followed by the nonce (at most 16 bytes so
 * the 0x01 marker plus nonce fit the 17-byte payload ceiling).
 */
export function bleHandshakeV2(nonce: Uint8Array): Uint8Array {
  if (nonce.length === 0 || nonce.length > 16) {
    throw new RangeError(`v2 handshake nonce needs 1 to 16 bytes, got ${nonce.length}`);
  }
  const payload = new Uint8Array(1 + nonce.length);
  payload[0] = BLE_V2_HANDSHAKE_MARK;
  payload.set(nonce, 1);
  return encodeBleHandshake(BLE_V2_HANDSHAKE_CMD, payload);
}

/** AES-GCM key for the v2 session: 16 bytes (AES-128) or 32 (AES-256). */
export interface BleV2Key {
  key: Uint8Array;
}

type BleGcmAlgorithm = "aes-128-gcm" | "aes-256-gcm";

function v2Algorithm(key: Uint8Array): BleGcmAlgorithm {
  if (key.length === 16) return "aes-128-gcm";
  if (key.length === 32) return "aes-256-gcm";
  throw new RangeError(`v2 session key needs 16 or 32 bytes, got ${key.length}`);
}

function checkV2Iv(iv: Uint8Array): void {
  if (iv.length !== BLE_V2_IV_LEN) throw new RangeError(`v2 IV needs ${BLE_V2_IV_LEN} bytes, got ${iv.length}`);
}

/** AES-GCM encrypt for the v2 session. The tag is always 16 bytes. */
export function bleV2Encrypt(key: BleV2Key, iv: Uint8Array, plaintext: Uint8Array, aad?: Uint8Array): { ciphertext: Uint8Array; tag: Uint8Array } {
  checkV2Iv(iv);
  const cipher = createCipheriv(v2Algorithm(key.key), Buffer.from(key.key), Buffer.from(iv), { authTagLength: BLE_V2_TAG_LEN });
  if (aad !== undefined) cipher.setAAD(Buffer.from(aad), { plaintextLength: plaintext.length });
  const body = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
  return { ciphertext: new Uint8Array(body), tag: new Uint8Array(cipher.getAuthTag()) };
}

/**
 * AES-GCM decrypt for the v2 session. Throws on auth failure. Tags that are
 * not 16 bytes are rejected before decrypting: the device silently ignores
 * a 12-byte tag, so accepting one here would claim a session that cannot work.
 */
export function bleV2Decrypt(key: BleV2Key, iv: Uint8Array, ciphertext: Uint8Array, tag: Uint8Array, aad?: Uint8Array): Uint8Array {
  checkV2Iv(iv);
  if (tag.length !== BLE_V2_TAG_LEN) {
    throw new RangeError(`v2 GCM tag needs ${BLE_V2_TAG_LEN} bytes, got ${tag.length}`);
  }
  const decipher = createDecipheriv(v2Algorithm(key.key), Buffer.from(key.key), Buffer.from(iv));
  if (aad !== undefined) decipher.setAAD(Buffer.from(aad), { plaintextLength: ciphertext.length });
  decipher.setAuthTag(Buffer.from(tag));
  const body = Buffer.concat([decipher.update(Buffer.from(ciphertext)), decipher.final()]);
  return new Uint8Array(body);
}

/** Shape of the owner-provided local key file (JSON). The file holds the hex only. */
export interface BleKeysFile {
  version: 1;
  keyHex: string;
}

function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) {
    throw new Error("key file: keyHex needs even-length hex");
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * Parses the owner-provided local key file contents. Never logs the key:
 * errors name the field, never the value.
 */
export function parseBleKeysFile(contents: string): BleV2Key {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents) as unknown;
  } catch {
    throw new Error("key file: needs JSON with { version: 1, keyHex }");
  }
  if (typeof parsed !== "object" || parsed === null) throw new Error("key file: needs JSON with { version: 1, keyHex }");
  const record = parsed as Record<string, unknown>;
  if (record["version"] !== 1) throw new Error("key file: version needs to be 1");
  if (typeof record["keyHex"] !== "string") throw new Error("key file: keyHex needs to be a hex string");
  const key = hexToBytes(record["keyHex"]);
  if (key.length !== 16 && key.length !== 32) throw new Error("key file: keyHex needs 32 or 64 hex chars");
  return { key };
}

/** Reads the owner-provided local key file. Never logs the key. */
export async function loadBleKeysFile(path: string): Promise<BleV2Key> {
  return parseBleKeysFile(await readFile(path, "utf8"));
}

/**
 * Explicit owner key decision (WP04 briefing section 7). The encrypted link
 * never falls back to a baked-in key: decided must be true with a file path,
 * otherwise this throws the UI copy so Setup shows the keys-needed state.
 */
export interface BleKeyDecision {
  decided: boolean;
  keyFilePath: string | null;
}

/** Gates key use on the owner decision. Throws the keys-needed copy until decided. */
export function requireOwnerKeyDecision(decision: BleKeyDecision): string {
  if (decision.decided !== true || decision.keyFilePath === null || decision.keyFilePath.length === 0) {
    throw new Error(BLE_KEYS_NEEDED_COPY);
  }
  return decision.keyFilePath;
}

/**
 * Verifies the decrypted v2 reply carries this device's SKU and MAC (WP04).
 * Comparison ignores MAC separators and case; both must appear.
 */
export function verifyBleV2Reply(plaintext: Uint8Array, sku: string, mac: string): boolean {
  const text = Buffer.from(plaintext).toString("utf8");
  const squashed = (s: string): string => s.toLowerCase().replace(/[^0-9a-f]/g, "");
  if (sku.length === 0 || mac.length === 0) return false;
  return text.includes(sku) && squashed(text).includes(squashed(mac));
}
