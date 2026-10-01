import { describe, expect, it } from "vitest";
import { KEYS, defaultFor, defineKey } from "./registry.js";

// T-QA-12 config validation properties (spec 84, T-CFG-04).
// The registry is generated, so these guard the generator: duplicate keys, a
// default that does not parse to its declared type, or an unknown key that
// stops throwing all fail below.

describe("config registry properties", () => {
  it("has unique keys in dotted sections", () => {
    const keys = KEYS.map((k) => k.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(/^[a-z0-9]+(\.[A-Za-z0-9*<>]+)+$/);
  });

  it("parses every default to its declared type", () => {
    for (const k of KEYS) {
      const v = defaultFor(k.key);
      if (k.type === "boolean") expect(typeof v).toBe("boolean");
      else if (k.type === "number") {
        expect(typeof v).toBe("number");
        expect(Number.isFinite(v as number)).toBe(true);
      } else if (k.type === "json") {
        expect(() => JSON.parse(JSON.stringify(v))).not.toThrow();
      } else {
        expect(typeof v).toBe("string");
        expect((v as string).length).toBeGreaterThan(0);
      }
    }
  });

  it("rejects unknown keys and keeps the QA thresholds sane", () => {
    expect(() => defineKey("no.such.key")).toThrow();
    expect(defaultFor("qa.validation.minPerCategory") as number).toBeGreaterThanOrEqual(1);
    expect(defaultFor("qa.sync.maxBeatErrorMs") as number).toBeGreaterThan(0);
    expect(defaultFor("qa.soak.maxMemSlopeMbPerHour") as number).toBeGreaterThanOrEqual(0);
    expect(defaultFor("qa.replay.timeToleranceMs") as number).toBeGreaterThanOrEqual(0);
  });
});
