import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GoveeLanManager, defaultDeviceName } from "./govee-lan.js";

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

  it("setColorFor addresses exactly the picked fixtures", async () => {
    const dir = mkdtempSync(join(tmpdir(), "autolight-registry-"));
    const path = join(dir, "govee-registry.json");

    writeFileSync(path, JSON.stringify({
      version: 1,
      devices: [
        {
          mac: "AA:BB:CC:DD:EE:05", sku: "H6076", name: "Left", enabled: true,
          ipHistory: ["127.0.0.1"], rung: "cached-unicast", lastSeenMs: 4,
        },
        {
          mac: "AA:BB:CC:DD:EE:06", sku: "H1A45", name: "Right", enabled: false,
          ipHistory: ["127.0.0.1"], rung: "cached-unicast", lastSeenMs: 5,
        },
      ],
    }));

    // A real port is needed for the senders; 0 keeps the reply socket
    // ephemeral so parallel workers never collide on 4002. Loopback senders
    // let the command path run without touching any physical LAN.
    const mgr = new GoveeLanManager({ ...quietOpts(path), replyPort: 0, loopbackScan: true });

    try {
      // Explicit picks ignore the enabled filter; unknown ids fail alone.
      const receipt = await mgr.setColorFor(["AA:BB:CC:DD:EE:06", "AA:BB:CC:DD:EE:99"], 10, 20, 30);
      expect(receipt.ok).toEqual(["AA:BB:CC:DD:EE:06"]);
      expect(receipt.failed.map((f) => f.mac)).toEqual(["AA:BB:CC:DD:EE:99"]);
    } finally {
      mgr.stop();
    }
  });

  it("a saved segment count survives a reload", () => {
    const dir = mkdtempSync(join(tmpdir(), "autolight-registry-"));
    const path = join(dir, "govee-registry.json");

    writeFileSync(path, JSON.stringify({
      version: 1,
      devices: [{
        mac: "AA:BB:CC:DD:EE:07", sku: "H6076", name: "Lamp", enabled: true, zones: null,
        ipHistory: ["10.0.0.12"], rung: "cached-unicast", lastSeenMs: 6,
      }],
    }));

    const first = new GoveeLanManager(quietOpts(path));

    try {
      first.registrySnapshot();
      first.setZones("AA:BB:CC:DD:EE:07", 14);
      first.saveRegistryNow();
    } finally {
      first.stop();
    }

    const second = new GoveeLanManager(quietOpts(path));

    try {
      expect(second.registrySnapshot()[0]).toMatchObject({ zones: 14 });
    } finally {
      second.stop();
    }
  });

  it("rejects alternate requests the rig cannot satisfy, with the fix named", async () => {
    const dir = mkdtempSync(join(tmpdir(), "autolight-registry-"));
    const path = join(dir, "govee-registry.json");

    writeFileSync(path, JSON.stringify({
      version: 1,
      devices: [{
        mac: "AA:BB:CC:DD:EE:08", sku: "H6076", name: "Solo", enabled: true, zones: null,
        ipHistory: ["127.0.0.1"], rung: "cached-unicast", lastSeenMs: 7,
      }],
    }));

    const mgr = new GoveeLanManager({ ...quietOpts(path), replyPort: 0, loopbackScan: true });

    try {
      mgr.registrySnapshot();
      expect(() => mgr.startAlternate({ mode: "lamps", speedMs: 200, colours: { a: [255, 255, 255], b: [0, 0, 0] } }))
        .toThrow(/two fixtures/);
      expect(() => mgr.startAlternate({ mode: "halves", speedMs: 200, colours: { a: [255, 255, 255], b: [0, 0, 0] } }))
        .toThrow(/saved segment count/);
      expect(mgr.alternateStatus()).toBeNull();
    } finally {
      await mgr.stopAlternate();
      mgr.stop();
    }
  });

  it("runs and stops the alternate runner over the enabled rig", async () => {
    const dir = mkdtempSync(join(tmpdir(), "autolight-registry-"));
    const path = join(dir, "govee-registry.json");

    writeFileSync(path, JSON.stringify({
      version: 1,
      devices: [
        { mac: "AA:BB:CC:DD:EE:09", sku: "H6076", name: "Left", enabled: true, zones: 2, ipHistory: ["127.0.0.1"], rung: "cached-unicast", lastSeenMs: 8 },
        { mac: "AA:BB:CC:DD:EE:0A", sku: "H6076", name: "Right", enabled: true, zones: null, ipHistory: ["127.0.0.1"], rung: "cached-unicast", lastSeenMs: 9 },
      ],
    }));

    const mgr = new GoveeLanManager({ ...quietOpts(path), replyPort: 0, loopbackScan: true });

    try {
      mgr.registrySnapshot();
      const receipt = mgr.startAlternate({ mode: "lamps", speedMs: 200, colours: { a: [10, 20, 30], b: [30, 20, 10] } });
      expect(receipt).toMatchObject({ mode: "lamps", fixtures: 2, colours: { a: [10, 20, 30], b: [30, 20, 10] } });
      expect(mgr.alternateStatus()).not.toBeNull();
      // A second start replaces the runner instead of stacking timers, and
      // the party effect survives into the status receipt.
      mgr.startAlternate({ mode: "lamps", speedMs: 100, colours: { a: [10, 20, 30], b: [0, 0, 0] }, effect: "jump", palette: [[1, 2, 3], [4, 5, 6]] });
      expect(mgr.alternateStatus()).toMatchObject({ effect: "jump" });
      expect(await mgr.stopAlternate()).toBe(true);
      expect(mgr.alternateStatus()).toBeNull();
      expect(await mgr.stopAlternate()).toBe(false);
    } finally {
      mgr.stop();
    }
  });

  it("names known models by default and leaves unknown ones on their MAC", () => {
    expect(defaultDeviceName("H1A45", "AA:BB:CC:DD:EE:01")).toBe("Strip lights");
    expect(defaultDeviceName("H6076", "AA:BB:CC:DD:EE:02")).toBe("Lamp");
    expect(defaultDeviceName("H9999", "AA:BB:CC:DD:EE:03")).toBe("AA:BB:CC:DD:EE:03");
  });

  it("beat effects demand a tempo and take live bpm updates", async () => {
    const dir = mkdtempSync(join(tmpdir(), "autolight-registry-"));
    const path = join(dir, "govee-registry.json");

    writeFileSync(path, JSON.stringify({
      version: 1,
      devices: [
        { mac: "AA:BB:CC:DD:EE:0B", sku: "H6076", name: "Left", enabled: true, zones: 2, ipHistory: ["127.0.0.1"], rung: "cached-unicast", lastSeenMs: 10 },
        { mac: "AA:BB:CC:DD:EE:0C", sku: "H6076", name: "Right", enabled: true, zones: 2, ipHistory: ["127.0.0.1"], rung: "cached-unicast", lastSeenMs: 11 },
      ],
    }));

    const mgr = new GoveeLanManager({ ...quietOpts(path), replyPort: 0, loopbackScan: true });

    try {
      mgr.registrySnapshot();
      expect(() => mgr.startAlternate({ mode: "lamps", speedMs: 60, colours: { a: [1, 2, 3], b: [0, 0, 0] }, effect: "beat-flash" }))
        .toThrow(/needs a tempo/);
      expect(mgr.alternateStatus()).toBeNull();

      const receipt = mgr.startAlternate({ mode: "lamps", speedMs: 60, colours: { a: [1, 2, 3], b: [0, 0, 0] }, effect: "beat-flash", bpm: 128 });

      expect(receipt).toMatchObject({ effect: "beat-flash", bpm: 128 });
      expect(mgr.setAlternateBpm(300)).toBe(true);
      expect(mgr.alternateStatus()).toMatchObject({ bpm: 300 });
      expect(await mgr.stopAlternate()).toBe(true);
      // Not running: a tempo update has nothing to apply to.
      expect(mgr.setAlternateBpm(120)).toBe(false);
    } finally {
      mgr.stop();
    }
  });

  it("power reaches a known fixture and rejects unknown ids", async () => {
    const dir = mkdtempSync(join(tmpdir(), "autolight-registry-"));
    const path = join(dir, "govee-registry.json");

    writeFileSync(path, JSON.stringify({
      version: 1,
      devices: [
        { mac: "AA:BB:CC:DD:EE:0D", sku: "H6076", name: "Lamp", enabled: true, ipHistory: ["127.0.0.1"], rung: "cached-unicast", lastSeenMs: 12 },
      ],
    }));

    const mgr = new GoveeLanManager({ ...quietOpts(path), replyPort: 0, loopbackScan: true });

    try {
      mgr.registrySnapshot();
      await expect(mgr.setPower("AA:BB:CC:DD:EE:0D", true)).resolves.toEqual({ mac: "AA:BB:CC:DD:EE:0D", on: true });
      await expect(mgr.setPower("AA:BB:CC:DD:EE:FF", true)).rejects.toThrow(/unknown device/);
    } finally {
      mgr.stop();
    }
  });
});
