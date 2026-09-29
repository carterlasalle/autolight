import { describe, expect, it } from "vitest";
import { resolveIdentity, coverageOf } from "./index.js";

describe("track-model", () => {
  it("prefers native id, never title alone", () => {
    expect(() => resolveIdentity({ title: "X", artist: "Y" })).toThrow();
    expect(resolveIdentity({ rekordboxId: "42" }).id).toBe("rb:42");
  });
  it("falls back down the hierarchy", () => {
    expect(resolveIdentity({ seratoPath: "/m/t.mp3" }).id).toBe("path:/m/t.mp3");
    expect(resolveIdentity({ fileHash: "ab".repeat(20) }).id.startsWith("hash:")).toBe(true);
  });
  it("grades coverage", () => {
    const grid = { version: 1, beats: [{ index: 0, beatInBar: 1, sourceTimeMs: 0, bpm: 128 }] } as never;
    expect(coverageOf({ beatGrid: grid, sections: [{ kind: "chorus" }], analysisCoverage: "full" } as never)).toBe("full");
    expect(coverageOf({ beatGrid: grid, sections: [], analysisCoverage: "full" } as never)).toBe("structured");
    expect(coverageOf({ beatGrid: { version: 1, beats: [] }, sections: [], analysisCoverage: "adaptive" } as never)).toBe("adaptive");
  });
});
