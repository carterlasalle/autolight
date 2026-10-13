import { describe, expect, it } from "vitest";
import type { TrackModel } from "@autolight/contracts";
import { resolveIdentity, coverageOf } from "./index.js";

function coverageModel(over: Pick<TrackModel, "beatGrid" | "sections" | "analysisCoverage">): Pick<TrackModel, "beatGrid" | "sections" | "analysisCoverage"> {
  return over;
}

describe("track-model", () => {
  it("prefers native id, never title alone", () => {
    expect(() => resolveIdentity({ title: "X", artist: "Y" })).toThrow();
    expect(resolveIdentity({ rekordboxId: "42" }).id).toBe("rb:42");
  });
  it("falls back down the hierarchy", () => {
    expect(resolveIdentity({ seratoPath: "/m/t.mp3" }).id).toBe("path:/m/t.mp3");
    expect(resolveIdentity({ fileHash: "ab".repeat(20) }).id.startsWith("hash:")).toBe(true);
  });
  it("keeps one stable id when a path gains a hash", () => {
    const hash = "cd".repeat(32);
    expect(resolveIdentity({ seratoPath: "/m/t.mp3", fileHash: hash }).id).toBe("path:/m/t.mp3");
    expect(resolveIdentity({ fileHash: hash }).id).toBe(`hash:${hash}`);
  });
  it("surfaces the worker-issued coverage level as-is", () => {
    const beat = { index: 0, beatInBar: 1 as const, sourceTimeMs: 0, bpm: 128 };
    const full = coverageModel({ beatGrid: { version: 1, beats: [beat] }, sections: [{ kind: "chorus", startBeat: 0, endBeat: 16, confidence: 0.9 }], analysisCoverage: "full" });
    expect(coverageOf(full)).toBe("full");
    expect(coverageOf({ ...full, sections: [] })).toBe("full");
    expect(coverageOf({ ...full, sections: [], analysisCoverage: "structured" })).toBe("structured");
    expect(coverageOf({ beatGrid: { version: 1, beats: [] }, sections: [], analysisCoverage: "adaptive" })).toBe("adaptive");
  });
});
