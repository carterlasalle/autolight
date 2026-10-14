import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GoveeLanManager } from "./govee-lan.js";

// Manager-level rows for the venue registry contract (spec 99, §49): saved
// lights hydrate before any scan, and rename / enabled survive a reload.
// Wire behaviors (setColor paths over UDP) live in services.test.ts.

function quietOpts(registryPath: string): ConstructorParameters<typeof GoveeLanManager>[0] {
  return {
    registryPath,
    multicast: false,
    perInterfaceBroadcast: false,
    globalBroadcast: false,
    scanList: [],
    backgroundRescanMs: 60000,
  };
}

describe("govee registry (venue hydration)", () => {
  it("registrySnapshot hydrates saved rows without starting sockets", () => {
    const dir = mkdtempSync(join(tmpdir(), "autolight-registry-"));
    const path = join(dir, "govee-registry.json");

    writeFileSync(path, JSON.stringify({
      version: 1,
      devices: [{
        mac: "AA:BB:CC:DD:EE:02", sku: "H1A45", name: "Saved lamp", enabled: false,
        ipHistory: ["10.0.0.9"], rung: "cached-unicast", lastSeenMs: 1,
      }],
    }));

    const mgr = new GoveeLanManager(quietOpts(path));

    try {
      const snap = mgr.registrySnapshot();
      expect(snap).toHaveLength(1);
      expect(snap[0]).toMatchObject({
        mac: "AA:BB:CC:DD:EE:02", sku: "H1A45", name: "Saved lamp",
        enabled: false, ip: "10.0.0.9", health: "offline",
      });
    } finally {
      mgr.stop();
    }
  });

  it("rename and enabled persist to the registry file and survive a reload", () => {
    const dir = mkdtempSync(join(tmpdir(), "autolight-registry-"));
    const path = join(dir, "govee-registry.json");

    writeFileSync(path, JSON.stringify({
      version: 1,
      devices: [{
        mac: "AA:BB:CC:DD:EE:03", sku: "H6076", name: "AA:BB:CC:DD:EE:03", enabled: true,
        ipHistory: ["10.0.0.10"], rung: "cached-unicast", lastSeenMs: 2,
      }],
    }));

    const first = new GoveeLanManager(quietOpts(path));

    try {
      first.registrySnapshot();
      expect(first.renameDevice("AA:BB:CC:DD:EE:03", "  Back left  ")).toEqual({ mac: "AA:BB:CC:DD:EE:03", name: "Back left" });
      expect(first.setDeviceEnabled("AA:BB:CC:DD:EE:03", false)).toEqual({ mac: "AA:BB:CC:DD:EE:03", enabled: false });
      first.saveRegistryNow();
    } finally {
      first.stop();
    }

    const second = new GoveeLanManager(quietOpts(path));

    try {
      expect(second.registrySnapshot()[0]).toMatchObject({ name: "Back left", enabled: false });
    } finally {
      second.stop();
    }
  });

  it("rename refuses an empty label", () => {
    const dir = mkdtempSync(join(tmpdir(), "autolight-registry-"));
    const path = join(dir, "govee-registry.json");

    writeFileSync(path, JSON.stringify({
      version: 1,
      devices: [{
        mac: "AA:BB:CC:DD:EE:04", sku: "H6076", name: "x", enabled: true,
        ipHistory: ["10.0.0.11"], rung: "cached-unicast", lastSeenMs: 3,
      }],
    }));

    const mgr = new GoveeLanManager(quietOpts(path));

    try {
      mgr.registrySnapshot();
      expect(() => mgr.renameDevice("AA:BB:CC:DD:EE:04", "   ")).toThrow(/non-empty/);
    } finally {
      mgr.stop();
    }
  });
});
