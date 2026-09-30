import { describe, expect, it } from "vitest";
import type { Fixture, ShowPlan } from "@autolight/contracts";
import { renderFrame, renderWithLatency, frameHash, latencyBeats } from "./index.js";

const plan = { schemaVersion: 1, plannerVersion: "x", trackId: "t", styleId: "s", seed: "a", cues: [
  { type: "impact", startBeat: 257, durationBeats: 2, intensity: 1, target: "ALL", priority: 90 },
  { type: "blackout", startBeat: 256, durationBeats: 1, intensity: 0, target: "ALL", priority: 100 },
]} as ShowPlan;
const mkFixture = (id: string, latencyMs: number | null, x = 0, groups: string[] = []): Fixture => ({
  id, adapter: "govee", sku: "H6076", hardwareId: id, groups,
  cells: [{ index: 0, position: { x, y: 0 }, order: 0, tags: [] }],
  calibration: latencyMs === null ? null : {
    segmentCount: 1, maxStableFps: 30, expectedLatencyMs: latencyMs, armSettleMs: 0,
    orientation: "forward", gamma: 2.2, brightnessCeiling: 1, firmwareVersion: "t",
  },
});

describe("renderer", () => {
  it("blackout wins at beat 256", () => {
    const f = renderFrame(plan, 256.5, [mkFixture("f1", null)]);
    expect([...f.get("f1")!]).toEqual([0, 0, 0]);
  });
  it("golden hash stable at beat 257", () => {
    expect(frameHash(renderFrame(plan, 257, [mkFixture("f1", null)]))).toBe(
      frameHash(renderFrame(plan, 257, [mkFixture("f1", null)])));
  });
  it("matches committed golden frame (§127)", () => {
    const f = renderFrame(plan, 257, [mkFixture("f1", null)]);
    expect([...f.get("f1")!]).toEqual([224, 224, 224]);
    expect(frameHash(f)).toBe("a0357d48");
  });
  it("compensates slow fixtures by sampling ahead", () => {
    expect(latencyBeats(500, 120)).toBeCloseTo(1);
    const out = renderWithLatency(plan, 256.5, [mkFixture("slow", 500), mkFixture("fast", 0)], 120);
    expect(frameHash(new Map([["slow", out.get("slow")!]]))).toBe(
      frameHash(renderFrame(plan, 257.5, [mkFixture("slow", 500)])));
    expect([...out.get("fast")!]).toEqual([0, 0, 0]);
  });
  it("paints only targeted cells for group cues", () => {
    const p: ShowPlan = { ...plan, cues: [
      { type: "section-look", startBeat: 0, durationBeats: 8, intensity: 1, target: "PRIMARY", priority: 10 },
    ] };
    const out = renderFrame(p, 1, [mkFixture("a", null, 0, ["PRIMARY"]), mkFixture("b", null, 1, ["SECONDARY"])]);
    expect([...out.get("a")!].some((v) => v > 0)).toBe(true);
    expect([...out.get("b")!]).toEqual([0, 0, 0]);
  });
  it("ramps builds and dims breakdowns", () => {
    const ramp: ShowPlan = { ...plan, cues: [
      { type: "build-ramp", startBeat: 0, durationBeats: 8, intensity: 1, target: "ALL", priority: 50 },
    ] };
    const early = renderFrame(ramp, 0.5, [mkFixture("f1", null)]);
    const late = renderFrame(ramp, 7.5, [mkFixture("f1", null)]);
    const sum = (m: Map<string, Uint8Array>): number => [...m.get("f1")!].reduce((a, b) => a + b, 0);
    expect(sum(late)).toBeGreaterThan(sum(early));
    const down: ShowPlan = { ...plan, cues: [
      { type: "breakdown-look", startBeat: 0, durationBeats: 8, intensity: 1, target: "ALL", priority: 40 },
    ] };
    expect(sum(renderFrame(down, 1, [mkFixture("f1", null)]))).toBeLessThan(sum(late));
  });
});
