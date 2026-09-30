import { describe, expect, it } from "vitest";
import { z } from "zod";
import { channels, channelNames } from "./index.js";

describe("ipc contract", () => {
  it("every channel has request plus response schemas with a version", () => {
    for (const name of channelNames()) {
      const ch = channels[name];
      expect(ch.request, name).toBeDefined();
      expect(ch.response, name).toBeDefined();
      const shape = (ch.request as unknown as { shape?: Record<string, unknown> }).shape;
      expect(shape, `${name} request must declare a version field`).toBeDefined();
      expect(Object.keys(shape ?? {}), name).toContain("version");
    }
  });
  it("response schemas accept ok and typed error shapes", () => {
    for (const name of channelNames()) {
      const ch = channels[name];
      expect(() => ch.response.parse({ ok: false, error: { code: "E_X", message: "x" } }), name).not.toThrow();
    }
  });
  it("rejects missing and mistyped fields", () => {
    expect(() => channels["master/freeze"].request.parse({ version: 1 })).toThrow();
    expect(() => channels["master/freeze"].request.parse({ version: 1, frozen: "yes" })).toThrow();
  });
});
