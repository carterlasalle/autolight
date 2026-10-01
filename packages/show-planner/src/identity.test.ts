// T-PLAN-02: whole-song identity and colour story (spec 28/29, P-28, P-29).
import { describe, expect, it } from "vitest";
import type { TrackModel } from "@autolight/contracts";
import { compileShow } from "./compile.js";
import { DEFAULT_CONFIG } from "./config.js";
import { BUILT_IN_STYLES } from "./styles.js";
import { oklchDistance } from "./color.js";
import { DEFAULT_VENUE_CLASS } from "./types.js";

function model(): TrackModel {
  return {
    schemaVersion: 1,
    analyzerVersion: "t",
    identity: { id: "trk1", sourceIds: {} },
    durationSeconds: 200,
    beatGrid: { version: 1, beats: [{ index: 0, beatInBar: 1, sourceTimeMs: 0, bpm: 128 }] },
    sections: [
      { kind: "verse", startBeat: 0, endBeat: 32, confidence: 0.9 },
      { kind: "build", startBeat: 32, endBeat: 64, confidence: 0.9 },
      { kind: "chorus", startBeat: 64, endBeat: 96, confidence: 0.9 },
      { kind: "chorus", startBeat: 96, endBeat: 128, confidence: 0.9 },
    ],
    musicalEvents: [
      { type: "build-start", beat: 32, endBeat: 64, confidence: 0.9 },
      { type: "drop", beat: 64, confidence: 0.95 },
    ],
    analysisCoverage: "full",
  } as TrackModel;
}

describe("T-PLAN-02 identity and colour (P-28, P-29)", () => {
  it("populates every globalDesign field and keeps 2 to 3 core colours plus a neutral", () => {
    const { plan } = compileShow({
      track: model(),
      venue: DEFAULT_VENUE_CLASS,
      style: BUILT_IN_STYLES["club"]!,
      config: DEFAULT_CONFIG,
    });
    const g = plan.globalDesign;
    expect(g.primary.length).toBeGreaterThanOrEqual(2);
    expect(g.primary.length + g.secondary.length).toBeLessThanOrEqual(3);
    expect(g.neutral.c).toBeLessThan(0.05);
    expect(g.spatialMotif.heads).toBeGreaterThanOrEqual(1);
    expect(g.movementVocabulary.length).toBeGreaterThan(0);
    expect(g.densityBaseline).toBeGreaterThan(0);
    expect(g.impactBudget).toBeGreaterThan(0);
    // Core colours are distinguishable on fixtures.
    const core = [...g.primary, ...g.secondary];
    for (let i = 0; i < core.length; i++) {
      for (let j = i + 1; j < core.length; j++) {
        expect(oklchDistance(core[i]!, core[j]!)).toBeGreaterThanOrEqual(
          DEFAULT_CONFIG.paletteMinDistance - 0.06,
        );
      }
    }
    // Section looks use the identity colour, not an invented hue.
    const look = plan.cues.find((c) => c.type === "section-look" && c.startBeat === 0)!;
    expect(look.color?.h).toBe(core[0]!.h);
  });

  it("changes colour only at section or motif-return boundaries", () => {
    const { plan } = compileShow({
      track: model(),
      venue: DEFAULT_VENUE_CLASS,
      style: BUILT_IN_STYLES["club"]!,
      config: DEFAULT_CONFIG,
    });
    const sections = new Set(plan.sections.map((s) => s.startBeat));
    const returns = new Set(
      plan.recurrence.motifs.flatMap((m) =>
        m.sections.slice(1).map((i) => plan.sections[i]!.startBeat),
      ),
    );
    // Colour identity lives on section looks: ramps desaturate toward white
    // and foreshadowing glimpses the drop motif by design, neither is a
    // palette change.
    const coloured = [...plan.cues]
      .filter((c) => c.color !== undefined && (c.type === "section-look" || c.type === "static-look"))
      .sort((a, b) => a.startBeat - b.startBeat);
    let last: string | null = null;
    let changes = 0;
    let justified = 0;
    for (const c of coloured) {
      const key = `${Math.round(c.color!.h)}`;
      if (last !== null && key !== last) {
        changes++;
        if (sections.has(c.startBeat) || returns.has(c.startBeat)) justified++;
      }
      last = key;
    }
    expect(changes).toBeGreaterThan(0);
    expect(justified / changes).toBe(1);
  });
});
