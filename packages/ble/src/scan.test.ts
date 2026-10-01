// T-BLE-02: scan and identity binding. Name families, encoded flag,
// pactType and pactCode read live on every scan; BLE entries stay distinct
// from LAN entries; binding needs an aa 14 Wi-Fi MAC match or an explicit
// user confirmation after an identify flash over BLE.
import { describe, expect, it } from "vitest";
import {
  BLE_NOT_ADVERTISING_GUIDANCE,
  bindBleToLan,
  nameFamilyOf,
  parseBleAdvertisement,
  toScanEntry,
} from "./scan.js";

describe("ble scan and binding (T-BLE-02)", () => {
  it("parses every name family", () => {
    expect(nameFamilyOf("GBK_H6076_AB12")).toBe("gbk");
    expect(nameFamilyOf("GVH607612AB")).toBe("gv");
    expect(nameFamilyOf("ihoment_ABC")).toBe("ihoment");
    expect(nameFamilyOf("Govee_ABC")).toBe("govee");
    expect(nameFamilyOf("Minger_ABC")).toBe("minger");
    expect(nameFamilyOf(null)).toBe("unknown");
    expect(nameFamilyOf("Other_light")).toBe("unknown");
  });

  it("reads the encoded flag, pactType and pactCode live on every scan", () => {
    const plain = parseBleAdvertisement({ address: "A1", name: "GBK_H6076_01", manufacturer: new Uint8Array([0x00, 7, 9]) });
    expect(plain.encoded).toBe(false);
    expect(plain.pactType).toBe(7);
    expect(plain.pactCode).toBe(9);
    expect(plain.family).toBe("gbk");
    const encoded = parseBleAdvertisement({ address: "A2", name: "GVH6076AB", manufacturer: new Uint8Array([0x40, 3, 5]) });
    expect(encoded.encoded).toBe(true);
    expect(encoded.pactType).toBe(3);
    expect(encoded.pactCode).toBe(5);
    expect(encoded.family).toBe("gv");
  });

  it("BLE entries are Bluetooth entries distinct from LAN entries", () => {
    const entry = toScanEntry(parseBleAdvertisement({ address: "A1", name: "Govee_ABC", manufacturer: new Uint8Array([0]) }));
    expect(entry.kind).toBe("bluetooth");
    expect(entry.guidance).toBeNull();
  });

  it("a missing expected device shows the close-the-app guidance", () => {
    const seen = parseBleAdvertisement({ address: "A1", name: "GBK_H6076_01", manufacturer: new Uint8Array([0]) });
    const missing = parseBleAdvertisement({ address: "A2", name: "GBK_H6076_02", manufacturer: new Uint8Array([0]) });
    const entry = toScanEntry(seen, missing);
    expect(entry.guidance).toBe(BLE_NOT_ADVERTISING_GUIDANCE);
  });

  it("binds on an aa 14 Wi-Fi MAC match across formats", () => {
    const binding = bindBleToLan({
      bleAddress: "AA:BB:CC:DD:EE:01",
      lanDeviceId: "lan-1",
      bleWifiMac: "AA-BB-CC-DD-EE-FF",
      lanWifiMac: "aa:bb:cc:dd:ee:ff",
      identifyConfirmed: false,
    });
    expect(binding.basis).toBe("wifi-mac-match");
    expect(binding.lanDeviceId).toBe("lan-1");
  });

  it("binds on explicit user confirmation after the BLE identify flash", () => {
    const binding = bindBleToLan({
      bleAddress: "AA:BB:CC:DD:EE:02",
      lanDeviceId: "lan-2",
      bleWifiMac: null,
      lanWifiMac: null,
      identifyConfirmed: true,
    });
    expect(binding.basis).toBe("user-confirmed-identify");
  });

  it("refuses to merge by SKU, name or address suffix", () => {
    expect(() => bindBleToLan({
      bleAddress: "AA:BB:CC:DD:EE:03",
      lanDeviceId: "lan-3",
      bleWifiMac: "11:22:33:44:55:66",
      lanWifiMac: "AA:BB:CC:DD:EE:FF",
      identifyConfirmed: false,
    })).toThrow(/aa 14|identify flash/);
    expect(() => bindBleToLan({
      bleAddress: "AA:BB:CC:DD:EE:04",
      lanDeviceId: "lan-4",
      bleWifiMac: null,
      lanWifiMac: null,
      identifyConfirmed: false,
    })).toThrow(/refusing to bind/);
  });
});
