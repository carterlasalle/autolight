import { describe, expect, it } from "vitest";
import { makeDeck } from "@autolight/simulator";
import { trackModelSchema, type DeckState, type ShowCue, type TrackModel } from "@autolight/contracts";
import { deckFields, nextPhraseBeat, predictiveLabel } from "./live-fields.js";

// Typed fixtures: makeDeck and the contract schema reject drift at compile or
// parse time instead of the test asserting against an `as unknown as` shape
// (batch-53).
const state: DeckState = makeDeck({
  deckId: 1,
  track: { id: "t1", sourceIds: {} },
  playing: true,
  playheadSeconds: 24,
  playRate: 1.02,
  effectiveBpm: 128.5,
  channelFader: 0.8,
  crossfader: 1,
});

const track: TrackModel = trackModelSchema.parse({
  schemaVersion: 2,
  analyzerVersion: "t",
  identity: { id: "t1", sourceIds: {}, title: "Track", artist: "Artist" },
  durationSeconds: 400,
  beatGrid: { version: 1, beats: [{ index: 0, beatInBar: 1, sourceTimeMs: 0, bpm: 128 }] },
  sections: [{ kind: "build", startBeat: 0, endBeat: 64, confidence: 0.9 }],
  musicalEvents: [],
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
});

describe("live deck fields (T-UI-02, spec 90)", () => {
  it("derives all deck fields from snapshot data", () => {
    const f = deckFields(state, track, null, 24);
    expect(f.title).toBe("Track");
    expect(f.source).toBe("REKORDBOX");
    expect(f.nativeBpm).toBe(128);
    expect(f.effectiveBpm).toBe(128.5);
    expect(f.bar).toBe(7);
    expect(f.phrase).toBe(1);
    expect(f.section).toBe("build");
    expect(f.analysisQuality).toBe("FULL");
  });
  it("labels missing data instead of guessing", () => {
    const idle = deckFields({ ...state, track: null, playing: false, channelFader: 0, effectiveBpm: null }, null, null, 0);
    expect(idle.title).toBe("No track");
    expect(idle.nativeBpm).toBeNull();
    expect(idle.nextEvent).toBeNull();
    // The degradation contract, in full: no section guess, the quality tag
    // reads NEEDS ANALYSIS, and beat 0 sits in bar/phrase 1 (batch-53).
    expect(idle.section).toBeNull();
    expect(idle.analysisQuality).toBe("NEEDS ANALYSIS");
    expect(idle.bar).toBe(1);
    expect(idle.phrase).toBe(1);
  });
  it("predicts the drop 8 beats out (P-90)", () => {
    const cues: ShowCue[] = [
      { type: "section-look", startBeat: 0, durationBeats: 32, intensity: 0.5, target: "PRIMARY", priority: 10 },
      { type: "white-hit", startBeat: 40, durationBeats: 0.25, intensity: 1, target: "ALL", priority: 100 },
    ];

    expect(predictiveLabel(cues, 32)).toBe("DROP IN 8");
  });
  it("prefers drops over breakdowns over builds, by type not priority", () => {
    const cues: ShowCue[] = [
      { type: "build-ramp", startBeat: 34, durationBeats: 10, intensity: 0.6, target: "PRIMARY", priority: 999 },
      { type: "breakdown-look", startBeat: 40, durationBeats: 16, intensity: 0.25, target: "AMBIENT", priority: 500 },
      { type: "white-hit", startBeat: 48, durationBeats: 0.25, intensity: 1, target: "ALL", priority: 1 },
    ];

    // Inverted priorities: the drop wins on TYPE despite the lowest number,
    // so a priority-based rewrite changes this outcome (batch-53).
    expect(predictiveLabel(cues, 32)).toBe("DROP IN 16");
    // Without the drop the breakdown wins over the in-window build...
    expect(predictiveLabel(cues.slice(0, 2), 32)).toBe("BREAKDOWN IN 8");
    // ...and an active build alone reports BUILD, not a countdown.
    expect(predictiveLabel([cues[0]!], 40)).toBe("BUILD");
    expect(nextPhraseBeat(33)).toBe(64);
  });
  it("returns null past the horizon and at the boundaries", () => {
    const drop: ShowCue = { type: "white-hit", startBeat: 200, durationBeats: 0.25, intensity: 1, target: "ALL", priority: 1 };

    // Empty set and a drop beyond the 64-beat horizon return null...
    expect(predictiveLabel([], 0)).toBeNull();
    expect(predictiveLabel([drop], 135)).toBeNull();
    // ...a drop exactly at the horizon counts, and rounding floors at 1.
    expect(predictiveLabel([drop], 136)).toBe("DROP IN 64");
    const near: ShowCue = { type: "impact", startBeat: 10.4, durationBeats: 0.25, intensity: 1, target: "ALL", priority: 1 };

    expect(predictiveLabel([near], 10)).toBe("DROP IN 1");
    // Phrase boundaries: zero and an exact phrase start.
    expect(nextPhraseBeat(0)).toBe(32);
    expect(nextPhraseBeat(64)).toBe(96);
  });
});
