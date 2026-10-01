// BLE scan and identity binding (T-BLE-02; WP04 scan and identity binding).
//
// Sources: WP04 which cites govee-toolkit docs/protocol/ble.md (all 9
// sections) and Lightwave DISCOVERY.md (BLE discovery-only lessons, distinct
// IDs, macOS permission identity). Name families, the encoded flag bit 0x40,
// pactType and pactCode are read live on every scan. BLE devices are
// Bluetooth entries distinct from LAN entries. A BLE address binds to a LAN
// device only through an aa 14 Wi-Fi MAC read that matches, or through an
// explicit user confirmation after an identify flash over BLE. SKU, name or
// address suffix merges are never taken.
//
// No claim here measures the owner's units; sim runs prove code, never hardware.
import { BLE_ENCODED_FLAG } from "./constants.js";

export type BleNameFamily = "gbk" | "gv" | "ihoment" | "govee" | "minger" | "unknown";

export interface BleAdvertisement {
  address: string;
  name: string | null;
  family: BleNameFamily;
  manufacturer: Uint8Array;
  encoded: boolean;
  pactType: number | null;
  pactCode: number | null;
  rssi: number | null;
}

export interface BleScanInput {
  address: string;
  name?: string | null;
  manufacturer?: Uint8Array | null;
  rssi?: number | null;
}

/** Parses one live advertisement. Manufacturer bytes carry the encoded flag (bit 0x40), pactType and pactCode. */
export function parseBleAdvertisement(input: BleScanInput): BleAdvertisement {
  const name = input.name ?? null;
  const manufacturer = input.manufacturer ?? new Uint8Array(0);
  const flag = manufacturer.length > 0 ? (manufacturer[0] ?? 0) : 0;
  return {
    address: input.address,
    name,
    family: nameFamilyOf(name),
    manufacturer: manufacturer.slice(),
    encoded: (flag & BLE_ENCODED_FLAG) === BLE_ENCODED_FLAG,
    pactType: manufacturer.length > 1 ? (manufacturer[1] ?? null) : null,
    pactCode: manufacturer.length > 2 ? (manufacturer[2] ?? null) : null,
    rssi: input.rssi ?? null,
  };
}

/** Classifies an advertisement name into its family. Legacy prefixes kept. */
export function nameFamilyOf(name: string | null): BleNameFamily {
  if (name === null || name.length === 0) return "unknown";
  if (name.startsWith("GBK_")) return "gbk";
  if (name.startsWith("GV")) return "gv";
  if (name.startsWith("ihoment_")) return "ihoment";
  if (name.startsWith("Govee_")) return "govee";
  if (name.startsWith("Minger_")) return "minger";
  return "unknown";
}

/** Guidance shown when an expected device is not advertising (WP04). */
export const BLE_NOT_ADVERTISING_GUIDANCE =
  "possibly connected to the Govee app or another controller; close it";

/** A Bluetooth scan entry: always distinct from a LAN entry (WP04). */
export interface BleScanEntry {
  kind: "bluetooth";
  advertisement: BleAdvertisement;
  guidance: string | null;
}

export function toScanEntry(ad: BleAdvertisement, missing: BleAdvertisement | null = null): BleScanEntry {
  return {
    kind: "bluetooth",
    advertisement: ad,
    guidance: missing === null ? null : BLE_NOT_ADVERTISING_GUIDANCE,
  };
}

/** How a BLE address was bound to a LAN device record. */
export type BleBindingBasis = "wifi-mac-match" | "user-confirmed-identify";

/** The binding record: never merge by SKU, name or address suffix. */
export interface BleBinding {
  bleAddress: string;
  lanDeviceId: string;
  basis: BleBindingBasis;
  wifiMac: string | null;
}

export interface BleBindingInputs {
  bleAddress: string;
  lanDeviceId: string;
  /** The aa 14 Wi-Fi MAC read over BLE, or null when unread. */
  bleWifiMac: string | null;
  /** The LAN record's Wi-Fi MAC, or null when unknown. */
  lanWifiMac: string | null;
  /** True after the user confirmed the BLE identify flash. */
  identifyConfirmed: boolean;
}

/** Binds a BLE address to a LAN record. Throws when neither basis holds. */
export function bindBleToLan(inputs: BleBindingInputs): BleBinding {
  const ble = normalizeMac(inputs.bleWifiMac);
  const lan = normalizeMac(inputs.lanWifiMac);
  if (ble !== null && lan !== null && ble === lan) {
    return { bleAddress: inputs.bleAddress, lanDeviceId: inputs.lanDeviceId, basis: "wifi-mac-match", wifiMac: inputs.bleWifiMac };
  }
  if (inputs.identifyConfirmed) {
    return {
      bleAddress: inputs.bleAddress,
      lanDeviceId: inputs.lanDeviceId,
      basis: "user-confirmed-identify",
      wifiMac: inputs.bleWifiMac,
    };
  }
  throw new Error("refusing to bind: needs an aa 14 Wi-Fi MAC match or an explicit user confirmation after a BLE identify flash");
}

/** Normalizes a MAC for comparison: lowercase, colon separated, null stays null. */
export function normalizeMac(mac: string | null): string | null {
  if (mac === null) return null;
  const hexes = mac.toLowerCase().replace(/[^0-9a-f]/g, "");
  if (hexes.length !== 12) return mac.toLowerCase();
  const parts: string[] = [];
  for (let i = 0; i < 12; i += 2) parts.push(hexes.slice(i, i + 2));
  return parts.join(":");
}
