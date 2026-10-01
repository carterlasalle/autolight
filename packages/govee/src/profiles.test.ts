// T-GOV-13 profile tests: the toolkit catalog loads devices/H6076.yaml and
// devices/H1A45.yaml, every number carries a receipt, nothing claims a
// hardware measurement, and the loader refuses a profile that breaks either
// rule. P-45-profiles, spec 45.
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_DEVICES_DIR,
  defaultRateHz,
  lintDeviceProfile,
  loadDeviceCatalog,
  parseProfileYaml,
  profileDefaultsFor,
  type DeviceProfile,
  type Measured,
} from "./profiles.js";

const HARDWARE_SOURCE = "hardware-measured";

function everyMeasurement(profile: DeviceProfile): { where: string; measured: Measured<unknown> }[] {
  const entries: { where: string; measured: Measured<unknown> }[] = [
    { where: "product_material_segments", measured: profile.productMaterialSegments },
    { where: "length_m", measured: profile.lengthMeters },
    { where: "capabilities.segmented", measured: profile.capabilities.segmented },
    { where: "capabilities.lan_razer", measured: profile.capabilities.lanRazer },
    { where: "capabilities.lan_json_control", measured: profile.capabilities.lanJsonControl },
    { where: "capabilities.ble", measured: profile.capabilities.ble },
    { where: "capabilities.matter", measured: profile.capabilities.matter },
    { where: "segment_chain", measured: profile.segmentChain },
    { where: "native_pixels_per_meter", measured: profile.nativePixelsPerMeter },
  ];
  for (const [key, measured] of Object.entries(profile.measurements)) {
    entries.push({ where: `measurements.${key}`, measured });
  }
  return entries;
}

describe("govee device profiles", () => {
  it("loads both SKU profiles with a receipt for every number and no hardware claim", () => {
    const catalog = loadDeviceCatalog();
    expect([...catalog.profiles.keys()].sort()).toEqual(["H1A45", "H6076"]);

    for (const sku of ["H6076", "H1A45"]) {
      const profile = profileDefaultsFor(catalog, sku);
      expect(profile.sku).toBe(sku);
      expect(profile.family).toBe("lan-razer");
      expect(profile.schema).toBe("govee-toolkit/device-profile@fork-1");
      expect(profile.qualificationRequired).toBe(true);
      expect(profile.modes).toContain("rgb-segmented");
      expect(lintDeviceProfile(profile)).toEqual([]);

      const measurements = everyMeasurement(profile);
      expect(measurements.length).toBeGreaterThan(0);
      for (const { where, measured } of measurements) {
        expect(measured.receipt.trim().length, `${sku} ${where} needs a receipt`).toBeGreaterThan(0);
        // No unit has been qualified on hardware, so no profile may claim a
        // hardware measurement. This is the line that keeps the profiles honest.
        expect(measured.source, `${sku} ${where}`).not.toBe(HARDWARE_SOURCE);
      }

      // The segmented channel is never assumed from the SKU (spec 42, F-X-09):
      // only the per-unit probe can set it, so it stays unmeasured here.
      expect(profile.capabilities.segmented.value).toBeNull();
      expect(profile.capabilities.lanRazer.value).toBeNull();
      expect(profile.capabilities.lanJsonControl.value).toBe(true);
    }

    const h6076 = profileDefaultsFor(catalog, "H6076");
    expect(h6076.measurements.armSettleMs.value).toBe(50);
    expect(h6076.measurements.turnEndsChannel.value).toBe(true);
    expect(h6076.productMaterialSegments.value).toBeNull();

    const h1a45 = profileDefaultsFor(catalog, "H1A45");
    expect(h1a45.lengthMeters.value).toBe(20);
    expect(h1a45.measurements.whiteEndsChannel.value).toBeNull();
  });

  it("encodes the toolkit ceiling table and the fallback rate", () => {
    const catalog = loadDeviceCatalog();
    const profile = profileDefaultsFor(catalog, "H6076");
    expect(profile.measurements.maxHzByZones.value).toEqual({ 20: 40, 60: 25, 120: 20 });
    expect(profile.measurements.fallbackHz.value).toBe(10);

    expect(defaultRateHz(profile, 8, 60)).toBe(10);
    expect(defaultRateHz(profile, 20, 60)).toBe(40);
    expect(defaultRateHz(profile, 40, 60)).toBe(40);
    expect(defaultRateHz(profile, 100, 60)).toBe(25);
    expect(defaultRateHz(profile, 200, 60)).toBe(20);
    // The target never wins over the ceiling, and the ceiling never wins over
    // the target when the target is lower.
    expect(defaultRateHz(profile, 20, 15)).toBe(15);
    expect(defaultRateHz(profile, 200, 60)).toBeLessThan(60);
  });

  it("refuses a profile whose number has no receipt", () => {
    const dir = mkdtempSync(join(tmpdir(), "autolight-profile-"));
    try {
      const text = readFileSync(new URL("H6076.yaml", DEFAULT_DEVICES_DIR), "utf8");
      writeFileSync(join(dir, "H6076.yaml"), text.replace(/receipt: [^\n]+/, 'receipt: ""'));
      expect(() => loadDeviceCatalog(dir)).toThrow(/receipt/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a profile whose file name does not match its SKU", () => {
    const dir = mkdtempSync(join(tmpdir(), "autolight-profile-"));
    try {
      writeFileSync(join(dir, "H0000.yaml"), readFileSync(new URL("H1A45.yaml", DEFAULT_DEVICES_DIR), "utf8"));
      expect(() => loadDeviceCatalog(dir)).toThrow(/does not match sku/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("parses the profile subset and rejects anything outside it", () => {
    const doc = parseProfileYaml([
      "# comment",
      "sku: H6076",
      "modes:",
      "  - rgb-segmented",
      "  - ble-single",
      "nested:",
      '  "20": 40',
      "  flag: true",
      "  empty: null",
      "  text: plain value",
    ].join("\n"));

    expect(doc["sku"]).toBe("H6076");
    expect(doc["modes"]).toEqual(["rgb-segmented", "ble-single"]);
    expect(doc["nested"]).toEqual({ 20: 40, flag: true, empty: null, text: "plain value" });
    expect(() => parseProfileYaml("this is not yaml")).toThrow(/expected "key: value"/);
  });
});
