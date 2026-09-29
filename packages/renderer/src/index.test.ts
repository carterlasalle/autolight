import { describe, expect, it } from "vitest";
import type { Fixture } from "@autolight/contracts";
import { renderFrame, renderWithLatency, frameHash, latencyBeats } from "./index.js";

const plan = { schemaVersion: 1, plannerVersion: "x", trackId: "t", styleId: "s", seed: "a", cues: [
  { type: "impact", startBeat: 257, durationBeats: 2, intensity: 1, target: "ALL", priority: 90 },
  { type: "blackout", startBeat: 256, durationBeats: 1, intensity: 0, target: "ALL", priority: 100 },
]} as never;
const mkFixture = (id: string, latencyMs: number | null): Fixture => ({
  id, adapter: "govee", sku: "H6076", hardwareId: id,
  cells: [{ index: 0, position: { x: 0, y: 0 }, order: 0, tags: [] }],
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
    // Drop impact at 257: hue(0*47 + 257*13 % 360 = 101°), full intensity.
    const f = renderFrame(plan, 257, [mkFixture("f1", null)]);
    expect(frameHash(f)).toBe("9325e8c61ab5a6c7");
  });
  it("compensates slow fixtures by sampling ahead", () => {
    expect(latencyBeats(500, 120)).toBeCloseTo(1);
    // Slow fixture at beat 256.5 samples 257.5 (impact), fast stays blackout.
    const out = renderWithLatency(plan, 256.5, [mkFixture("slow", 500), mkFixture("fast", 0)], 120);
    expect(frameHash(new Map([["slow", out.get("slow")!]]))).toBe(
      frameHash(renderFrame(plan, 257.5, [mkFixture("slow", 500)])));
    expect([...out.get("fast")!]).toEqual([0, 0, 0]);
  });
});
