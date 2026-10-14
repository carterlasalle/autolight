import { describe, expect, it } from "vitest";
import { emptyMetrics, SessionRecorder, parseNdjson, log } from "./index.js";

describe("diagnostics", () => {
  it("starts metrics at zero", () => {
    expect(emptyMetrics()).toEqual({
      djUpdateRateHz: 0, djStateAgeMs: 0, beatErrorBeats: 0, renderMs: 0,
      rendererFps: 0, deviceFps: {}, supersededFrames: 0, deviceLatencyMs: {},
    });
  });
  it("records and serializes session events", () => {
    const r = new SessionRecorder(2);
    r.record("deck", { deckId: 1 });
    r.record("cue", { type: "drop" });
    r.record("cue2", { type: "rise" });
    expect(r.count()).toBe(2);
    const lines = r.toNdjson().split("\n");
    expect(lines).toHaveLength(2);
    // oldest ("deck") evicted, newest ("cue2") retained
    expect(lines.map((l) => JSON.parse(l).kind)).toEqual(["cue", "cue2"]);
  });
  it("logs structured rows", () => {
    const row = log("renderer", "info", "frame");
    expect(row).toMatchObject({ module: "renderer", severity: "info", event: "frame" });
    expect(typeof row.monoNs).toBe("bigint");
    expect(Number.isNaN(Date.parse(row.ts))).toBe(false);
  });
  it("tails the newest events for live diagnostics", () => {
    const r = new SessionRecorder(100);
    r.record("a", { i: 1 });
    r.record("b", { i: 2 });
    r.record("c", { i: 3 });
    expect(r.tail(2).map((e) => e.kind)).toEqual(["b", "c"]);
    expect(r.tail(0)).toEqual([]);
    expect(r.tail(99)).toHaveLength(3);
  });
  it("round-trips ndjson for simulator replay", () => {
    const r = new SessionRecorder();
    r.record("deck", { deckId: 1 });
    r.record("cue", { level: 3 });
    const rows = parseNdjson(r.toNdjson());
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ kind: "deck", payload: { deckId: 1 } });
    expect(rows[1]).toMatchObject({ kind: "cue", payload: { level: 3 } });
    expect(typeof rows[0]!.tNs).toBe("string");
    expect(() => parseNdjson("not json")).toThrow("session line 1");
    expect(() => parseNdjson('{"kind":"deck","payload":{},"tNs":"1"}\nnot json')).toThrow("session line 2");
  });
});
