import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KEYS, defineKey, defaultFor, ConfigStore } from "./index.js";
import { CONFIG_CHANGED, PersistentConfigStore, validateImportValues } from "./store.js";

describe("config registry", () => {
  it("holds all 240 catalog keys with receipts", () => {
    expect(KEYS.length).toBe(240);
    for (const k of KEYS) {
      expect(k.receipt.length, k.key).toBeGreaterThan(0);
    }
  });
  it("rejects unknown keys", () => {
    expect(() => defineKey("nope.missing")).toThrow(/unknown-config-key/);
    expect(() => defaultFor("nope.missing")).toThrow();
  });
  it("resolves device over app over default", () => {
    const s = new ConfigStore();
    expect(s.get("runtime.clock.tickHz")).toBe(60);
    expect(s.layerOf("runtime.clock.tickHz")).toBe("default");
    s.set("app", "runtime.clock.tickHz", 90);
    expect(s.get("runtime.clock.tickHz")).toBe(90);
    expect(s.layerOf("runtime.clock.tickHz")).toBe("app");
    s.set("device", "runtime.clock.tickHz", 120);
    expect(s.get("runtime.clock.tickHz")).toBe(120);
    s.reset("device", "runtime.clock.tickHz");
    expect(s.get("runtime.clock.tickHz")).toBe(90);
  });
  it("rejects invalid imports naming every bad key", () => {
    const s = new ConfigStore();
    const bad = s.importJson(JSON.stringify({ version: 1, values: {
      "nope.key": 1,
      "runtime.clock.tickHz": "fast",
    } }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.badKeys.join("\n")).toContain("nope.key");
      expect(bad.badKeys.join("\n")).toContain("runtime.clock.tickHz");
    }
    expect(s.importJson("{oops")).toEqual({ ok: false, badKeys: ["<unparseable JSON>"] });
  });
  it("round-trips export and import", () => {
    const a = new ConfigStore();
    a.set("app", "runtime.clock.tickHz", 90);
    const b = new ConfigStore();
    expect(b.importJson(a.exportJson())).toEqual({ ok: true });
    expect(b.get("runtime.clock.tickHz")).toBe(90);
  });
});

describe("secrets boundary (T-SEC-01)", () => {
  it("refuses secret ids through set and import", () => {
    const s = new ConfigStore();
    expect(() => s.set("app", "govee.cloud.apiKey", "PLAIN")).toThrow(/secrets-service/);
    const bad = s.importJson(JSON.stringify({ version: 1, values: { "govee.cloud.apiKey": "PLAIN" } }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.badKeys.join("\n")).toContain("govee.cloud.apiKey");
    expect(validateImportValues({ "agent.apiToken": "PLAIN" }).join("\n")).toContain("agent.apiToken");
  });
});

describe("config persistence (T-CFG-02)", () => {
  it("device-scope value persists across re-instantiation and wins over app", () => {
    const dir = mkdtempSync(join(tmpdir(), "autolight-cfg-"));
    try {
      const file = join(dir, "config.json");
      const a = new PersistentConfigStore(file);
      a.set("app", "runtime.clock.tickHz", 90);
      a.set("device", "runtime.clock.tickHz", 120);
      expect(a.get("runtime.clock.tickHz")).toBe(120);
      const b = new PersistentConfigStore(file);
      expect(b.get("runtime.clock.tickHz")).toBe(120);
      expect(b.layerOf("runtime.clock.tickHz")).toBe("device");
      b.reset("device", "runtime.clock.tickHz");
      expect(b.get("runtime.clock.tickHz")).toBe(90);
      const c = new PersistentConfigStore(file);
      expect(c.get("runtime.clock.tickHz")).toBe(90);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("invalid import names every bad key with range and fix", () => {
    const bad = validateImportValues({
      "nope.key": 1,
      "runtime.clock.tickHz": 5,
      "runtime.snapshot.uiRateHz": "fast",
    });
    const joined = bad.join("\n");
    expect(bad.length).toBe(3);
    expect(joined).toContain("nope.key");
    expect(joined).toContain("runtime.clock.tickHz");
    expect(joined).toContain("30 to 120");
    expect(joined).toContain("runtime.snapshot.uiRateHz");
    expect(joined).toContain("fix:");
    const store = new PersistentConfigStore();
    const res = store.importJson(JSON.stringify({ version: 1, values: { "nope.key": 1, "runtime.clock.tickHz": 5 } }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.badKeys.join("\n")).toContain("30 to 120");
    expect(store.get("runtime.clock.tickHz")).toBe(60);
  });
  it("exposes live-safe metadata per key", () => {
    expect(defineKey("runtime.snapshot.uiRateHz").liveSafe).toBe(true);
    expect(defineKey("runtime.clock.tickHz").liveSafe).toBe(false);
    expect(KEYS.find((k) => k.key === "runtime.snapshot.uiRateHz")?.liveSafe).toBe(true);
  });
  it("emits config:changed with the diff", () => {
    expect(CONFIG_CHANGED).toBe("config:changed");
    const store = new PersistentConfigStore();
    const seen: { key: string; before: unknown; after: unknown; liveSafe: boolean; layer: string }[] = [];
    const off = store.subscribe((c) => { seen.push(c); });
    store.set("app", "runtime.snapshot.uiRateHz", 45);
    expect(seen.length).toBe(1);
    expect(seen[0]).toMatchObject({ key: "runtime.snapshot.uiRateHz", before: 30, after: 45, liveSafe: true, layer: "app" });
    off();
    store.set("app", "runtime.snapshot.uiRateHz", 50);
    expect(seen.length).toBe(1);
  });
});
