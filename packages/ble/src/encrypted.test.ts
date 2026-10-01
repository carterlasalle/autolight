// T-BLE-07: encrypted link DS-05 (keys are an owner decision, AES-GCM).
//
// Proves DS-05 behind govee.ble.encryptedLink (off/on/auto): the toolkit
// E7 01 / E7 02 session-seed handshake, the v2 E7 11 01 handshake, AES-GCM
// with a 16-byte tag (a 12-byte tag is rejected here because the device
// silently ignores it), the decrypted-reply check for SKU plus MAC, the
// owner key decision gate ( undecided throws the keys-needed UI copy), and
// the local key file parser (random test keys only, never vendor constants).
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  BLE_KEYS_NEEDED_COPY,
  BLE_V2_TAG_LEN,
  bleHandshakeSeedFrames,
  bleHandshakeV2,
  bleV2Decrypt,
  bleV2Encrypt,
  encryptedLinkNeed,
  loadBleKeysFile,
  parseBleKeysFile,
  requireOwnerKeyDecision,
  verifyBleV2Reply,
} from "./encrypted.js";
import { SimPeripheral } from "./sim.js";

let dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

const tmp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "ble-keys-"));
  dirs.push(dir);
  return dir;
};

describe("ble encrypted link (T-BLE-07)", () => {
  it("builds the toolkit seed handshake and the v2 handshake shapes", () => {
    const seed = new Uint8Array([1, 2, 3, 4]);
    const frames = bleHandshakeSeedFrames(seed);
    expect(frames.e701[0]).toBe(0xe7);
    expect(frames.e701[1]).toBe(0x01);
    expect([...frames.e701.slice(2, 6)]).toEqual([1, 2, 3, 4]);
    expect(frames.e701).toHaveLength(20);
    expect(frames.e702[0]).toBe(0xe7);
    expect(frames.e702[1]).toBe(0x02);
    expect(() => bleHandshakeSeedFrames(new Uint8Array(0))).toThrow(/1 to 17/);
    const v2 = bleHandshakeV2(new Uint8Array([9, 9, 9]));
    expect(v2[0]).toBe(0xe7);
    expect(v2[1]).toBe(0x11);
    expect(v2[2]).toBe(0x01);
    expect([...v2.slice(3, 6)]).toEqual([9, 9, 9]);
    expect(() => bleHandshakeV2(new Uint8Array(0))).toThrow(/1 to 16/);
  });

  it("round trips AES-GCM with a 16-byte tag and rejects a 12-byte tag", () => {
    const key = { key: randomBytes(16) };
    const iv = randomBytes(12);
    const plaintext = new TextEncoder().encode("sku=H6076 mac=aa:bb:cc:dd:ee:ff");
    const { ciphertext, tag } = bleV2Encrypt(key, iv, plaintext);
    expect(tag).toHaveLength(BLE_V2_TAG_LEN);
    expect([...bleV2Decrypt(key, iv, ciphertext, tag)]).toEqual([...plaintext]);
    expect(() => bleV2Decrypt(key, iv, ciphertext, new Uint8Array(12))).toThrow(/16 bytes/);
    const tampered = ciphertext.slice();
    tampered[0] = (tampered[0] ?? 0) ^ 0xff;
    expect(() => bleV2Decrypt(key, iv, tampered, tag)).toThrow();
    expect(() => bleV2Encrypt(key, new Uint8Array(8), plaintext)).toThrow(/12 bytes/);
    expect(() => bleV2Encrypt({ key: new Uint8Array(7) }, iv, plaintext)).toThrow(/16 or 32/);
  });

  it("verifies the decrypted reply carries the device SKU and MAC", () => {
    const reply = new TextEncoder().encode("sku=H6076 mac=AA:BB:CC:DD:EE:FF ok");
    expect(verifyBleV2Reply(reply, "H6076", "aa:bb:cc:dd:ee:ff")).toBe(true);
    expect(verifyBleV2Reply(reply, "H6076", "11:22:33:44:55:66")).toBe(false);
    expect(verifyBleV2Reply(reply, "H9999", "aa:bb:cc:dd:ee:ff")).toBe(false);
  });

  it("gates keys on the explicit owner decision, never a baked-in key", () => {
    expect(() => requireOwnerKeyDecision({ decided: false, keyFilePath: null })).toThrow(BLE_KEYS_NEEDED_COPY);
    expect(() => requireOwnerKeyDecision({ decided: true, keyFilePath: null })).toThrow(BLE_KEYS_NEEDED_COPY);
    expect(requireOwnerKeyDecision({ decided: true, keyFilePath: "/owner/ble-keys.json" })).toBe("/owner/ble-keys.json");
  });

  it("reads keys only from the owner-provided local file and rejects bad shapes", async () => {
    const dir = tmp();
    const path = join(dir, "ble-keys.json");
    const hex = Buffer.from(randomBytes(16)).toString("hex");
    writeFileSync(path, JSON.stringify({ version: 1, keyHex: hex }));
    const loaded = await loadBleKeysFile(path);
    expect(loaded.key).toHaveLength(16);
    expect(parseBleKeysFile(JSON.stringify({ version: 1, keyHex: hex })).key).toHaveLength(16);
    expect(() => parseBleKeysFile("not json")).toThrow(/JSON/);
    expect(() => parseBleKeysFile(JSON.stringify({ version: 2, keyHex: hex }))).toThrow(/version/);
    expect(() => parseBleKeysFile(JSON.stringify({ version: 1, keyHex: "zz" }))).toThrow(/hex/);
    expect(() => parseBleKeysFile(JSON.stringify({ version: 1, keyHex: "abcd" }))).toThrow(/32 or 64/);
  });

  it("selects the handshake by DS-05 mode and answers both schemes on the sim", async () => {
    expect(encryptedLinkNeed(new Uint8Array([0x40]), 2, "auto").handshakeRequired).toBe(true);
    expect(encryptedLinkNeed(new Uint8Array([0]), null, "auto").handshakeRequired).toBe(false);
    expect(encryptedLinkNeed(new Uint8Array([0]), null, "off").handshakeRequired).toBe(false);
    expect(encryptedLinkNeed(new Uint8Array([0]), null, "on").handshakeRequired).toBe(true);

    const seedSim = new SimPeripheral({ address: "AA:BB:CC:DD:EE:71", zones: 2, handshakeSeed: true });
    const seed = bleHandshakeSeedFrames(new Uint8Array([5, 6, 7, 8]));
    const seedAcks: number[] = [];
    seedSim.subscribe((notify) => {
      if (notify[0] === 0x33 && notify[1] === 0x01) seedAcks.push(1);
      if (notify[0] === 0x33 && notify[1] === 0x02) seedAcks.push(2);
    });
    seedSim.handleWrite(seed.e701, 1000);
    seedSim.handleWrite(seed.e702, 2000);
    expect(seedSim.handshakeDone).toBe(true);

    const v2Sim = new SimPeripheral({
      address: "AA:BB:CC:DD:EE:72",
      zones: 2,
      manufacturer: new Uint8Array([0x40, 4, 7]),
      versionByte: 2,
      sku: "H6076",
      wifiMac: "aa:bb:cc:dd:ee:72",
      v2Key: { key: randomBytes(16) },
    });
    v2Sim.handleWrite(bleHandshakeV2(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])), 3000);
    expect(v2Sim.handshakeDone).toBe(true);
    const replyText = v2Sim.readV2ReplyText() ?? "";
    expect(verifyBleV2Reply(new TextEncoder().encode(replyText), "H6076", "aa:bb:cc:dd:ee:72")).toBe(true);
  });
});
