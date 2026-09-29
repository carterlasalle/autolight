import { describe, expect, it } from "vitest";
import { clockHealth, evaluateCues, loopBeat, quantizeResume, trackDeck } from "./index.js";
import { makeDeck } from "@autolight/simulator";
import type { ShowPlan } from "@autolight/contracts";

const plan = {
  schemaVersion: 1, plannerVersion: "x", trackId: "t", styleId: "s", seed: "a",
  cues: [
    { type: "blackout", startBeat: 256, durationBeats: 1, intensity: 0, target: "ALL", priority: 100 },
    { type: "impact", startBeat: 257, durationBeats: 2, intensity: 1, target: "ALL", priority: 90 },
  ],
} as ShowPlan;

describe("show-runtime", () => {
  it("evaluates cues at arbitrary beats without history", () => {
    expect(evaluateCues(plan, 256.5).map((c) => c.type)).toEqual(["blackout"]);
    expect(evaluateCues(plan, 257).map((c) => c.type)).toEqual(["impact"]);
    expect(evaluateCues(plan, 200)).toEqual([]);
  });
  it("loops beats with pass counting", () => {
    expect(loopBeat(130, 129, 137)).toEqual({ beat: 130, pass: 0 });
    expect(loopBeat(138, 129, 137)).toEqual({ beat: 130, pass: 1 });
    expect(loopBeat(100, 129, 137).pass).toBe(0);
  });
  it("snaps on seek, holds on scratch", () => {
    const seek = trackDeck(10, makeDeck({ playheadSeconds: 90 }), (s) => s, { seekThresholdBeats: 8 });
    expect(seek.seeked).toBe(true);
    expect(seek.beat).toBe(90);
    const scratch = trackDeck(10, makeDeck({ playRate: -1 }), (s) => s);
    expect(scratch.scratchHold).toBe(true);
    expect(scratch.beat).toBe(10);
  });
  it("degrades clock in stages, never cuts out", () => {
    expect(clockHealth(0)).toBe("live");
    expect(clockHealth(200)).toBe("extrapolating");
    expect(clockHealth(1000)).toBe("holding");
    expect(clockHealth(5000)).toBe("degraded");
  });
  it("quantizes override resume (default bar)", () => {
    expect(quantizeResume(33.2, "immediate")).toBe(34);
    expect(quantizeResume(33.2, "bar")).toBe(36);
    expect(quantizeResume(33.2, "phrase")).toBe(48);
  });
});
