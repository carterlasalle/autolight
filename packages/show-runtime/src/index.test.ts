import { describe, expect, it } from "vitest";
import {
  advanceOverride,
  clockHealth,
  estimatePosition,
  evaluateCues,
  initialOverrideState,
  loopBeat,
  overrideEffect,
  quantizeResume,
  resumeGridFromModel,
  setOverride,
  trackDeck,
  upcomingCues,
} from "./index.js";
import { makeDeck } from "@autolight/simulator";
import type { ShowPlan, TrackModel } from "@autolight/contracts";

const plan = {
  schemaVersion: 1, plannerVersion: "x", trackId: "t", styleId: "s", seed: "a",
  cues: [
    { type: "blackout", startBeat: 256, durationBeats: 1, intensity: 0, target: "ALL", priority: 100 },
    { type: "impact", startBeat: 257, durationBeats: 2, intensity: 1, target: "ALL", priority: 90 },
    { type: "section-look", startBeat: 300, durationBeats: 16, intensity: 0.8, target: "PRIMARY", priority: 10 },
  ],
} as ShowPlan;

const model: TrackModel = {
  schemaVersion: 1,
  analyzerVersion: "test",
  identity: { id: "t", sourceIds: {} },
  durationSeconds: 240,
  beatGrid: {
    version: 1,
    beats: Array.from({ length: 64 }, (_, i) => ({
      index: i,
      beatInBar: ((i % 4) + 1) as 1 | 2 | 3 | 4,
      sourceTimeMs: i * 500,
      bpm: 120,
    })),
  },
  sections: [
    { kind: "intro", startBeat: 0, endBeat: 32, confidence: 1 },
    { kind: "drop", startBeat: 32, endBeat: 64, confidence: 1 },
  ],
  musicalEvents: [],
  analysisCoverage: "full",
};

describe("show-runtime", () => {
  it("evaluates cues at arbitrary beats without history", () => {
    expect(evaluateCues(plan, 256.5).map((c) => c.type)).toEqual(["blackout"]);
    expect(evaluateCues(plan, 257).map((c) => c.type)).toEqual(["impact"]);
    expect(evaluateCues(plan, 200)).toEqual([]);
  });
  it("lists upcoming cues from the snapshot with their real fields", () => {
    const next = upcomingCues(plan, 200, 2);
    expect(next.map((c) => c.startBeat)).toEqual([256, 257]);
    expect(next[1]!.durationBeats).toBe(2);
    expect(next[1]!.priority).toBe(90);
    expect(upcomingCues(plan, 320)).toEqual([]);
  });
  it("loops beats with pass counting", () => {
    expect(loopBeat(130, 129, 137)).toEqual({ beat: 130, pass: 0 });
    expect(loopBeat(138, 129, 137)).toEqual({ beat: 130, pass: 1 });
    expect(loopBeat(100, 129, 137).pass).toBe(0);
  });
  it("snaps on seek and follows a reverse timeline", () => {
    const seek = trackDeck(10, makeDeck({ playheadSeconds: 90 }), (s) => s, { seekThresholdBeats: 8 });
    expect(seek.seeked).toBe(true);
    expect(seek.beat).toBe(90);
    // A forward rate deviation is a scratch: the look holds.
    const jog = trackDeck(10, makeDeck({ playRate: 0.2 }), (s) => s);
    expect(jog.scratchHold).toBe(true);
    expect(jog.beat).toBe(10);
    // A steady reverse is a reverse effect: the cursor follows the source.
    const reverse = trackDeck(10, makeDeck({ playheadSeconds: 8, playRate: -1 }), (s) => s);
    expect(reverse.scratchHold).toBe(false);
    expect(reverse.beat).toBe(8);
  });
  it("track-sync matrix: pitch, seek, loop, scratch, crossfade (§119)", () => {
    // Pitch ±8/±16%: playRate scales extrapolation, beat identity holds.
    const atRate = (rate: number): number => estimatePosition(
      makeDeck({ playheadSeconds: 10, playRate: rate, receivedAtNs: 0n }), 1_000_000_000n,
    );
    expect(atRate(1.08)).toBeCloseTo(11.08);
    expect(atRate(0.84)).toBeCloseTo(10.84);
    // Forward + backward seeks both snap, and the beat-space threshold never
    // compares beats against milliseconds.
    expect(trackDeck(50, makeDeck({ playheadSeconds: 10 }), (s) => s).seeked).toBe(true);
    expect(trackDeck(10, makeDeck({ playheadSeconds: 90 }), (s) => s).seeked).toBe(true);
    expect(trackDeck(10, makeDeck({ playheadSeconds: 10.1, effectiveBpm: 120 }), (s) => s).seeked).toBe(false);
    // Loop sizes: 4-beat, 1-beat, 1/2, 1/4 rolls all fold into the window.
    expect(loopBeat(140, 129, 133)).toEqual({ beat: 132, pass: 2 });
    expect(loopBeat(129.5, 129, 130)).toEqual({ beat: 129.5, pass: 0 });
    expect(loopBeat(129.75, 129, 129.5)).toEqual({ beat: 129.25, pass: 1 });
    // Cue restart: playhead 0 from mid-track snaps without replaying history.
    const cue = trackDeck(90, makeDeck({ playheadSeconds: 0 }), (s) => s);
    expect(cue.seeked).toBe(true);
    expect(evaluateCues(plan, 200)).toEqual([]);
  });
  it("degrades clock in stages, never cuts out", () => {
    expect(clockHealth(0)).toBe("live");
    expect(clockHealth(200)).toBe("extrapolating");
    expect(clockHealth(1000)).toBe("holding");
    expect(clockHealth(5000)).toBe("degraded");
  });
  it("quantizes resume from native downbeats and fused phrases, default bar (spec 134)", () => {
    // Without a model the fallback keeps the historical beat multiples.
    expect(quantizeResume(33.2, "immediate")).toBe(33.2);
    expect(quantizeResume(33.2, "beat")).toBe(34);
    expect(quantizeResume(33.2, "bar")).toBe(36);
    expect(quantizeResume(33.2, "phrase")).toBe(48);
    // With a model, bars come from beatInBar === 1 and phrases from sections.
    const grid = resumeGridFromModel(model);
    expect(grid.barBeats.slice(0, 3)).toEqual([0, 4, 8]);
    expect(grid.phraseBeats).toEqual([0, 32]);
    expect(quantizeResume(33.2, "beat", grid)).toBe(34);
    expect(quantizeResume(33.2, "bar", grid)).toBe(36);
    // No phrase starts after 33.2 in this model: the fallback multiple applies.
    expect(quantizeResume(33.2, "phrase", grid)).toBe(48);
    expect(quantizeResume(30, "phrase", grid)).toBe(32);
    expect(quantizeResume(0, "bar", resumeGridFromModel(null))).toBe(0);
  });
  it("implements every manual override control and the resume machine", () => {
    let state = initialOverrideState();
    expect(state.kind).toBe("none");
    expect(overrideEffect(state).factor).toBe(1);
    state = setOverride(state, "blackout", { beat: 8 });
    expect(overrideEffect(state)).toMatchObject({ kind: "blackout", factor: 0 });
    state = setOverride(state, "white", { beat: 8, whiteIntensity: 0.4 });
    expect(overrideEffect(state).white).toBeCloseTo(0.4, 6);
    state = setOverride(state, "freeze", { beat: 8 });
    expect(overrideEffect(state).hold).toBe(true);
    state = setOverride(state, "force-low", { beat: 8 });
    expect(overrideEffect(state).energy).toBe(0.25);
    state = setOverride(state, "force-high", { beat: 8 });
    expect(overrideEffect(state).energy).toBe(1);
    // Default resume is bar; immediate is really immediate.
    state = setOverride(state, "none", { beat: 8 });
    expect(state.resumeAt).toBe("bar");
    expect(state.resumeBeat).toBe(8);
    expect(state.pendingResume).toBe(false);
    state = setOverride(state, "blackout", { beat: 9 });
    state = setOverride(state, "none", { beat: 9 });
    expect(state.resumeBeat).toBe(12);
    expect(state.pendingResume).toBe(true);
    expect(advanceOverride(state, 10).resumed).toBe(false);
    expect(advanceOverride(state, 12).resumed).toBe(true);
    expect(advanceOverride(state, 12).state.kind).toBe("none");
  });
});
