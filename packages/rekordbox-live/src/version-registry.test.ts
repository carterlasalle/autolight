import { describe, expect, it } from "vitest";
import {
  detectMacosVersion,
  detectWindowsVersion,
  qualifyProvider,
  recordQualification,
  registryStatus,
  seedRegistry,
  unverifiedBanner,
  versionInRange,
  parseRegistry,
  serializeRegistry,
} from "./version-registry.js";

describe("version registry (T-LIVE-13, spec 145, 146)", () => {
  it("matches version ranges on the stem, not the prefix", () => {
    expect(versionInRange("7.2.19", "7.2.x")).toBe(true);
    expect(versionInRange("7.2.19.0012", "7.2.x")).toBe(true);
    expect(versionInRange("7.3.0", "7.2.x")).toBe(false);
    expect(versionInRange("7.2.19", "7.2.19")).toBe(true);
  });

  it("reports qualified, unverified and unsupported per provider", () => {
    const registry = seedRegistry();
    expect(qualifyProvider(registry, "rkbx-osc", "9.9.9", "macos").status).toBe("unsupported");
    expect(qualifyProvider(registry, "rkbx-osc", "7.2.19", "windows").status).toBe("unsupported");
    const unverified = qualifyProvider(registry, "rkbx-osc", "7.2.19", "macos");
    expect(unverified.status).toBe("unverified");
    expect(unverified.reason).toContain("UNVERIFIED REKORDBOX VERSION");
    const qualified = recordQualification(
      registry, "rkbx-osc", "7.2.x", "macos",
      { date: "2026-10-01", machine: "owner-m1", runbook: "HW-RB-RKBX-01", result: "pass", notes: "replay passed" },
      true,
    );
    expect(qualifyProvider(qualified, "rkbx-osc", "7.2.19", "macos").status).toBe("qualified");
    const failed = recordQualification(
      registry, "rkbx-osc", "7.2.x", "macos",
      { date: "2026-10-01", machine: "owner-m1", runbook: "HW-RB-RKBX-01", result: "pass", notes: "broken" },
      false,
    );
    expect(qualifyProvider(failed, "rkbx-osc", "7.2.19", "macos").status).toBe("unverified");
  });

  it("shows the banner for a simulated 9.9.9 without a modal", () => {
    const registry = seedRegistry();
    const banner = unverifiedBanner(registry, "9.9.9", "macos");
    expect(banner).toBeNull();
    const banner72 = unverifiedBanner(registry, "7.2.19", "macos");
    expect(banner72).toContain("UNVERIFIED REKORDBOX VERSION 7.2.19");
    const statuses = registryStatus(registry, "7.2.19", "macos");
    expect(statuses.length).toBeGreaterThanOrEqual(6);
    expect(statuses.every((s) => s.status === "unverified")).toBe(true);
  });

  it("detects versions from the bundle plist and the file version", () => {
    expect(detectMacosVersion('<plist><key>CFBundleShortVersionString</key><string>7.2.19</string></plist>')).toBe("7.2.19");
    expect(detectMacosVersion("<plist></plist>")).toBeNull();
    expect(detectWindowsVersion("7.2.19.0012")).toBe("7.2.19.0012");
    expect(detectWindowsVersion("  ")).toBeNull();
  });

  it("round-trips the registry through JSON for the generated fixture metadata", () => {
    const registry = seedRegistry();
    const parsed = parseRegistry(serializeRegistry(registry));
    expect(parsed).toHaveLength(registry.length);
    expect(parsed[0]?.decoder).toBe(registry[0]?.decoder);
  });
});
