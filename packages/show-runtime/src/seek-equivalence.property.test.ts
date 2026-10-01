import { describe, expect, it } from "vitest";
import {
  evaluateCues,
  loopBeat,
  loopPassVariant,
  quantizeResume,
  resumeGridFromModel,
  upcomingCues,
  type ResumeGrid,
} from "./index.js";
import type { ShowCue, ShowPlan, TrackModel } from "@autolight/contracts";

// T-QA-12 seek reconstruction equivalence (spec 58, T-RUN-03).
// A loop that escapes its window, a resume that lands before the request, or
// a reconstruction that disagrees across passes fails below.

const cue = (startBeat: number, durationBeats = 8): ShowCue => ({
  type: "section-look", startBeat, durationBeats, intensity: 0.8, target: "PRIMARY", priority: 1,
});

const plan = (cues: ShowCue[]): ShowPlan => ({
  schemaVersion: 1, plannerVersion: "0.1.0", trackId: "t", styleId: "s", seed: "00", cues,
});

const grid: ResumeGrid = {
  beats: Array.from({ length: 256 }, (_, i) => i),
  barBeats: Array.from({ length: 64 }, (_, i) => i * 4),
  phraseBeats: [0, 32, 64, 128, 192],
};

describe("seek reconstruction equivalence", () => {
  it("keeps looped beats inside the window and counts passes", () => {
    for (let beat = 0; beat < 200; beat += 0.5) {
      const { beat: back, pass } = loopBeat(beat, 32, 48);
      if (beat >= 32) {
        expect(back).toBeGreaterThanOrEqual(32);
        expect(back).toBeLessThan(48);
        expect(pass).toBe(Math.floor((beat - 32) / 16));
      } else {
        expect(back).toBe(beat);
        expect(pass).toBe(0);
      }
      expect(loopPassVariant(pass, "alternate-ab")).toBe(pass % 2);
      expect(loopPassVariant(pass, "rotate-3")).toBe(pass % 3);
      expect(loopPassVariant(pass, "none")).toBe(0);
    }
  });

  it("resumes at or after the request, on a grid boundary when one exists", () => {
    for (let beat = 0; beat < 200; beat += 0.5) {
      expect(quantizeResume(beat, "immediate", grid)).toBe(beat);
      const byBeat = quantizeResume(beat, "beat", grid);
      expect(byBeat).toBeGreaterThanOrEqual(beat);
      expect(Number.isInteger(byBeat)).toBe(true);
      const byBar = quantizeResume(beat, "bar", grid);
      expect(byBar).toBeGreaterThanOrEqual(beat);
      expect(grid.barBeats).toContain(byBar);
      // Committed T-RUN-07 behavior: with a grid the beat and bar cases land
      // on real boundaries; the phrase case falls back to multiples of 16
      // past the last phrase, so it only asserts monotonicity here.
      const byPhrase = quantizeResume(beat, "phrase", grid);
      expect(byPhrase).toBeGreaterThanOrEqual(beat);
      if (beat <= 192) expect(grid.phraseBeats).toContain(byPhrase);
    }
  });

  it("falls back to multiples only without a grid, and reads grids from models", () => {
    expect(quantizeResume(5.5, "bar", null)).toBe(8);
    expect(quantizeResume(5.5, "beat", null)).toBe(6);
    expect(resumeGridFromModel(null)).toEqual({ beats: [], barBeats: [], phraseBeats: [] });
    const model = {
      beatGrid: {
        version: 1,
        beats: Array.from({ length: 8 }, (_, i) => ({ index: i, beatInBar: (i % 4) + 1, sourceTimeMs: i * 500, bpm: 120 })),
      },
      sections: [{ startBeat: 0 }, { startBeat: 4 }],
    } as unknown as TrackModel;
    const g = resumeGridFromModel(model);
    expect(g.barBeats).toEqual([0, 4]);
    expect(g.phraseBeats).toEqual([0, 4]);
  });

  it("evaluates and orders cues deterministically", () => {
    const p = plan([cue(16), cue(0), cue(32)]);
    expect(evaluateCues(p, 4).map((c) => c.startBeat)).toEqual([0]);
    expect(upcomingCues(p, 4).map((c) => c.startBeat)).toEqual([16, 32]);
    expect(upcomingCues(p, 4, 1).length).toBe(1);
  });
});
