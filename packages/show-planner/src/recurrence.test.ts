// T-PLAN-08: recurrence and motif memory (P-2.6, P-37).
import { describe, expect, it } from "vitest";
import type { TrackModel } from "@autolight/contracts";
import { compileShow } from "./compile.js";
import { DEFAULT_CONFIG } from "./config.js";
import { planRecurrence, summarizeSections } from "./recurrence.js";
import { BUILT_IN_STYLES } from "./styles.js";
import { DEFAULT_VENUE_CLASS, mulberry32 } from "./types.js";

function chorusTrack(): TrackModel {
  return {
    schemaVersion: 1,
    analyzerVersion: "t",
    identity: { id: "motif", sourceIds: {} },
    durationSeconds: 400,
    beatGrid: { version: 1, beats: [{ index: 0, beatInBar: 1, sourceTimeMs: 0, bpm: 128 }] },
    sections: [
      { kind: "verse", startBeat: 0, endBeat: 32, confidence: 0.9 },
      { kind: "chorus", startBeat: 32, endBeat: 64, confidence: 0.9 },
      { kind: "verse", startBeat: 64, endBeat: 96, confidence: 0.9 },
      { kind: "chorus", startBeat: 96, endBeat: 128, confidence: 0.9 },
      { kind: "breakdown", startBeat: 128, endBeat: 160, confidence: 0.9 },
    ],
    musicalEvents: [],
    analysisCoverage: "full",
  } as TrackModel;
}

describe("T-PLAN-08 recurrence (P-2.6, P-37)", () => {
  it("reuses the motif id on a returning chorus with a declared variation", () => {
    const track = chorusTrack();
    const { plan } = compileShow({
      track,
      venue: DEFAULT_VENUE_CLASS,
      style: BUILT_IN_STYLES["club"]!,
      config: DEFAULT_CONFIG,
    });
    const motif = (i: number): string | null => plan.sections[i]!.motifId;
    expect(motif(1)).toBe(motif(3));
    const entry = plan.recurrence.motifs.find((m) => m.id === motif(1))!;
    expect(entry.sections).toEqual(expect.arrayContaining([1, 3]));
    const v1 = entry.variations[1]!;
    const v3 = entry.variations[3]!;
    expect([v1.direction, v3.direction].sort()).toEqual(["forward", "reverse"]);
    expect(v1.fixtures).not.toBe(v3.fixtures);
    // The plan shows the variation, not an identical copy.
    const looks = [1, 3].map(
      (i) => plan.cues.find((c) => c.type === "section-look" && c.startBeat === plan.sections[i]!.startBeat)!,
    );
    expect(looks[0]!.target).not.toBe(looks[1]!.target);
  });

  it("never shares a motif between dissimilar sections", () => {
    const track = chorusTrack();
    const summaries = summarizeSections(
      track.sections,
      DEFAULT_CONFIG.sectionEnergy,
      [{ l: 0.6, c: 0.12, h: 200 }],
    );
    const { motifOf } = planRecurrence(
      summaries,
      [{ l: 0.6, c: 0.12, h: 200 }],
      0.6,
      DEFAULT_CONFIG,
      "seed",
    );
    const rand = mulberry32("seed");
    void rand;
    expect(motifOf[1]).toBe(motifOf[3]);
    expect(motifOf[4]).not.toBe(motifOf[1]);
    expect(motifOf[0]).not.toBe(motifOf[4]);
  });
});
