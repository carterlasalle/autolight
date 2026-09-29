import { describe, expect, it } from "vitest";
import { emptyMetrics, SessionRecorder, log } from "./index.js";

describe("diagnostics", () => {
  it("starts metrics at zero", () => {
    expect(emptyMetrics().supersededFrames).toBe(0);
  });
  it("records and serializes session events", () => {
    const r = new SessionRecorder(2);
    r.record("deck", { deckId: 1 });
    r.record("cue", { type: "drop" });
    r.record("overflow", {});
    expect(r.count()).toBe(2);
    const lines = r.toNdjson().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).kind).toBe("cue");
  });
  it("logs structured rows", () => {
    expect(log("renderer", "info", "frame").module).toBe("renderer");
  });
});
