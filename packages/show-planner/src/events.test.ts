// T-PLAN-07: consume every event with confidence and strength.
import { describe, expect, it } from "vitest";
import type { TrackModel } from "@autolight/contracts";
import { compileShow } from "./compile.js";
import { DEFAULT_CONFIG } from "./config.js";
import { planEvent } from "./events.js";
import { BUILT_IN_STYLES } from "./styles.js";
import { DEFAULT_VENUE_CLASS } from "./types.js";

const style = BUILT_IN_STYLES["club"]!;

function trackWith(type: string, confidence: number, strength?: number): TrackModel {
  return {
    schemaVersion: 2,
    analyzerVersion: "t",
    identity: { id: `ev-${type}`, sourceIds: {} },
    durationSeconds: 200,
    beatGrid: { version: 1, beats: [{ index: 0, beatInBar: 1, sourceTimeMs: 0, bpm: 128 }] },
    sections: [{ kind: "verse", startBeat: 0, endBeat: 64, confidence: 0.9 }],
    musicalEvents: [
      {
        type,
        beat: 16,
        endBeat: 24,
        confidence,
        ...(strength === undefined ? {} : { strength }),
      },
    ],
    analysisCoverage: "full",
    readinessLevel: "full",
    analysisCoverage2: {
      level: "full",
      inputs: {
        "source.audio": { status: "absent" },
        "native.rekordbox.grid": { status: "present" },
        "native.rekordbox.pssi": { status: "present" },
        "native.rekordbox.cues": { status: "absent" },
        "native.rekordbox.waveforms": { status: "absent" },
        "native.rekordbox.vocal": { status: "absent" },
        "native.serato.grid": { status: "absent" },
        "native.serato.markers": { status: "absent" },
        "ml.allinone.structure": { status: "absent" },
        "ml.allinone.metrical": { status: "absent" },
        "ml.allinone.activations": { status: "absent" },
        "ml.allinone.embeddings": { status: "absent" },
        "ml.stems": { status: "absent" },
        "ml.beatthis": { status: "absent" },
        "dsp.features": { status: "absent" },
        "dsp.stemProxies": { status: "absent" },
        "events.detectors": { status: "absent" },
        "fusion.structure": { status: "present" },
        "plan.generated": { status: "absent" },
      },
    },
    gridWarnings: [],
    beatFeatures: [],
    phrases: [],
  } as unknown as TrackModel;
}

const EXPECTED: Record<string, string> = {
  "major-section-transition": "phrase-turn",
  "minor-phrase-transition": "phrase-turn",
  "build-start": "build-ramp",
  "build-intensification": "build-ramp",
  predrop: "dip",
  drop: "impact",
  "fake-drop": "blackout",
  "drop-continuation": "drop-pattern",
  breakdown: "breakdown-look",
  "bass-re-entry": "impact",
  "drum-re-entry": "impact",
  fill: "fill-accent",
  silence: "blackout",
  "vocal-entry": "vocal-focus",
  "vocal-exit": "vocal-focus",
  "final-hit": "final-hit",
  "outro-release": "outro-release",
  "section-transition": "phrase-turn",
  "large-transient": "bump",
  pause: "blackout",
};

describe("T-PLAN-07 event consumption", () => {
  for (const [type, cue] of Object.entries(EXPECTED)) {
    it(`maps ${type} to ${cue}`, () => {
      const planned = planEvent(type, 16, 24, 0.9, 0.8, style, DEFAULT_CONFIG, false);
      expect(planned?.cueType).toBe(cue);
    });
  }

  it("gives a low-confidence drop a reveal, never a white hit and never nothing", () => {
    const soft = planEvent("drop", 64, undefined, 0.3, 0.9, style, DEFAULT_CONFIG, false);
    expect(soft?.cueType).toBe("reveal");
    const { plan } = compileShow({
      track: trackWith("drop", 0.3, 0.9),
      venue: DEFAULT_VENUE_CLASS,
      style,
      config: DEFAULT_CONFIG,
    });
    expect(plan.cues.some((c) => c.type === "reveal")).toBe(true);
    expect(plan.cues.some((c) => c.type === "white-hit")).toBe(false);
  });

  it("scales intensity with strength", () => {
    const weak = planEvent("fill", 16, 17, 0.9, 0.2, style, DEFAULT_CONFIG, false)!;
    const strong = planEvent("fill", 16, 17, 0.9, 1, style, DEFAULT_CONFIG, false)!;
    expect(strong.intensity).toBeGreaterThan(weak.intensity);
  });
});
