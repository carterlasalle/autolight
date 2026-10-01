import { describe, expect, it } from "vitest";
import { deckFields, nextPhraseBeat, predictiveLabel } from "./live-fields.js";
import type { DeckState, TrackModel } from "@autolight/contracts";

const state = {
  source: "rekordbox", deckId: 1, track: { id: "t1", sourceIds: {} },
  playing: true, playheadSeconds: 24, playRate: 1.02, effectiveBpm: 128.5,
  loop: { active: false, startSeconds: null, endSeconds: null, beatLength: null },
  channelFader: 0.8, crossfader: 1, master: null, receivedAtNs: 0n,
} as unknown as DeckState;

const track = {
  identity: { id: "t1", sourceIds: {}, title: "Track", artist: "Artist" },
  beatGrid: { beats: [{ index: 0, beatInBar: 1, sourceTimeMs: 0, bpm: 128 }] },
  sections: [{ kind: "build", startBeat: 0, endBeat: 64, confidence: 0.9 }],
  musicalEvents: [],
  analysisCoverage: "full",
} as unknown as TrackModel;

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
  });
  it("predicts the drop 8 beats out (P-90)", () => {
    const cues = [
      { type: "section-look", startBeat: 0, durationBeats: 32, intensity: 0.5, target: "PRIMARY", priority: 10 },
      { type: "white-hit", startBeat: 40, durationBeats: 0.25, intensity: 1, target: "ALL", priority: 100 },
    ];
    expect(predictiveLabel(cues as never[], 32)).toBe("DROP IN 8");
  });
  it("prefers drops over breakdowns over builds", () => {
    const cues = [
      { type: "breakdown-look", startBeat: 40, durationBeats: 16, intensity: 0.25, target: "AMBIENT", priority: 40 },
      { type: "white-hit", startBeat: 48, durationBeats: 0.25, intensity: 1, target: "ALL", priority: 100 },
    ];
    expect(predictiveLabel(cues as never[], 32)).toBe("DROP IN 16");
    expect(nextPhraseBeat(33)).toBe(64);
  });
});
