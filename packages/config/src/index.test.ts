import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KEYS, defineKey, defaultFor, ConfigStore } from "./index.js";
import { CONFIG_CHANGED, PersistentConfigStore, validateImportValues } from "./store.js";

describe("config registry", () => {
  it("holds all 244 catalog keys with receipts", () => {
    expect(KEYS.length).toBe(244);

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

    // Atomicity: a rejected import must not partially apply valid values.
    const mixed = s.importJson(JSON.stringify({ version: 1, values: {
      "runtime.snapshot.uiRateHz": 45,
      "nope.key": 1,
    } }));
    expect(mixed.ok).toBe(false);
    expect(s.get("runtime.snapshot.uiRateHz")).toBe(30);

  });
  it("round-trips export and import", () => {
    const a = new ConfigStore();
    a.set("app", "runtime.clock.tickHz", 90);
    const b = new ConfigStore();
    expect(b.importJson(a.exportJson())).toEqual({ ok: true });
    expect(b.get("runtime.clock.tickHz")).toBe(90);
  });
  it("rejects malformed documents and out-of-range numbers, and preserves layers on round trip", () => {
    const s = new ConfigStore();
    // `JSON.parse("null")` is legal JSON; the old code crashed on `.values`.
    expect(s.importJson("null")).toEqual({ ok: false, badKeys: ["<unsupported config document>"] });
    expect(s.importJson(JSON.stringify({ version: 2, values: {} }))).toEqual({ ok: false, badKeys: ["<unsupported config document>"] });
    // Range/NaN enforcement matches validateImportValues in store.ts.
    const ranged = s.importJson(JSON.stringify({ version: 1, values: { "runtime.clock.tickHz": 5 } }));
    expect(ranged.ok).toBe(false);
    if (!ranged.ok) expect(ranged.badKeys.join("\n")).toContain("30 to 120");
    expect(s.importJson(JSON.stringify({ version: 1, values: { "runtime.clock.tickHz": Number.NaN } })).ok).toBe(false);
    expect(() => s.set("app", "runtime.clock.tickHz", undefined)).toThrow(/reset/);
    // Layers survive a round trip instead of collapsing into app overrides.
    const layered = new ConfigStore();
    layered.set("app", "runtime.clock.tickHz", 90);
    layered.set("device", "runtime.clock.tickHz", 120);
    const restored = new ConfigStore();
    expect(restored.importJson(layered.exportJson())).toEqual({ ok: true });
    expect(restored.get("runtime.clock.tickHz")).toBe(120);
    expect(restored.layerOf("runtime.clock.tickHz")).toBe("device");
  });
});

describe("secrets boundary (T-SEC-01)", () => {
  it("refuses secret ids through set and import", () => {
    const s = new ConfigStore();
    expect(() => s.set("app", "govee.cloud.apiKey", "PLAIN")).toThrow(/secrets-service/);
    const bad = s.importJson(JSON.stringify({ version: 1, values: { "govee.cloud.apiKey": "PLAIN" } }));
    expect(bad.ok).toBe(false);

    if (!bad.ok) {
      expect(bad.badKeys.join("\n")).toContain("govee.cloud.apiKey");
      expect(bad.badKeys.join("\n")).toContain("secrets-service");
    }
    const agentMsg = validateImportValues({ "agent.apiToken": "PLAIN" }).join("\n");
    expect(agentMsg).toContain("agent.apiToken");
    expect(agentMsg).toContain("secrets-service");
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
    expect(joined).toContain("allowed range");
    expect(joined).toContain("runtime.snapshot.uiRateHz");
    expect(joined).toContain("fix:");
    const store = new PersistentConfigStore();
    const res = store.importJson(JSON.stringify({ version: 1, values: { "nope.key": 1, "runtime.clock.tickHz": 5 } }));
    expect(res.ok).toBe(false);

    if (!res.ok) expect(res.badKeys.join("\n")).toContain("allowed range");
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
    const first: { key: string; before: unknown; after: unknown; liveSafe: boolean; layer: string }[] = [];
    const second: { key: string; before: unknown; after: unknown; liveSafe: boolean; layer: string }[] = [];
    const offFirst = store.subscribe((c) => { first.push(c); });
    const offSecond = store.subscribe((c) => { second.push(c); });
    store.set("app", "runtime.snapshot.uiRateHz", 45);
    expect(first.length).toBe(1);
    expect(second.length).toBe(1);
    expect(first[0]).toMatchObject({ key: "runtime.snapshot.uiRateHz", before: 30, after: 45, liveSafe: true, layer: "app" });
    // Successive set: before reflects the previously-set value, not the default.
    store.set("app", "runtime.snapshot.uiRateHz", 50);
    expect(first.length).toBe(2);
    expect(first[1]).toMatchObject({ key: "runtime.snapshot.uiRateHz", before: 45, after: 50 });
    expect(second.length).toBe(2);
    // off() removes only the unsubscribed listener.
    offFirst();
    store.set("app", "runtime.snapshot.uiRateHz", 55);
    expect(first.length).toBe(2);
    expect(second.length).toBe(3);
    expect(second[2]).toMatchObject({ before: 50, after: 55 });
    offSecond();
    store.set("app", "runtime.snapshot.uiRateHz", 60);
    expect(first.length).toBe(2);
    expect(second.length).toBe(3);
  });
});
