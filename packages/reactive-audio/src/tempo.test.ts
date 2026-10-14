import { describe, expect, it } from "vitest";
import { createTempoTracker } from "./tempo.js";

// Synthetic flux pulses: one strong onset per beat, quiet frames between.
function train(bpm: number, beats: number, startMs: number): { flux: number; t: number }[] {
  const period = 60_000 / bpm;
  const out: { flux: number; t: number }[] = [];

  for (let i = 0; i < beats; i++) {
    const t = startMs + i * period;

    for (let k = 0; k < 4; k++) out.push({ flux: 0.5, t: t + k * (period / 5) });
    out.push({ flux: 50, t: t + period - 5 });
  }

  return out;
}

describe("tempo tracker (onset flux to bpm, no audio hardware)", () => {
  it("locks onto a steady 120 BPM train", () => {
    const tracker = createTempoTracker();
    let bpm: number | null = null;

    for (const s of train(120, 12, 0)) bpm = tracker.push(s.flux, s.t);

    expect(bpm).not.toBeNull();
    expect(Math.abs((bpm ?? 0) - 120)).toBeLessThan(3);
  });

  it("stays silent on flat input", () => {
    const tracker = createTempoTracker();

    for (let i = 0; i < 60; i++) expect(tracker.push(0.5, i * 20)).toBeNull();
  });

  it("follows a real tempo change after three consistent estimates", () => {
    const tracker = createTempoTracker();

    for (const s of train(120, 8, 0)) tracker.push(s.flux, s.t);

    let bpm: number | null = null;

    for (const s of train(150, 8, 4000)) bpm = tracker.push(s.flux, s.t);

    expect(Math.abs((bpm ?? 0) - 150)).toBeLessThan(5);
  });

  it("ignores one extra accent inside a steady train", () => {
    const tracker = createTempoTracker();

    for (const s of train(120, 4, 0)) tracker.push(s.flux, s.t);

    // A stray hit 250 ms after a beat: past the refractory, inside the beat.
    tracker.push(0.5, 2000);
    tracker.push(60, 2249);

    let bpm: number | null = null;

    for (const s of train(120, 8, 2500)) bpm = tracker.push(s.flux, s.t);

    expect(Math.abs((bpm ?? 0) - 120)).toBeLessThan(5);
  });
});
