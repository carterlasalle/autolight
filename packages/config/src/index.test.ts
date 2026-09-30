import { describe, expect, it } from "vitest";
import { KEYS, defineKey, defaultFor, ConfigStore } from "./index.js";

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
