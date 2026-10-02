// T-PLAN-13: layer tags and mixing metadata (spec 33).
import { describe, expect, it } from "vitest";
import type { TrackModel } from "@autolight/contracts";
import { compileShow } from "./compile.js";
import { DEFAULT_CONFIG } from "./config.js";
import { layerForCueName } from "./layers-fallback.js";
import { BUILT_IN_STYLES } from "./styles.js";
import { DEFAULT_VENUE_CLASS, isPlanLayer } from "./types.js";

function model(): TrackModel {
  return {
    schemaVersion: 2, analyzerVersion: "t", identity: { id: "layers", sourceIds: {} },
    durationSeconds: 400,
    beatGrid: { version: 1, beats: [{ index: 0, beatInBar: 1, sourceTimeMs: 0, bpm: 128 }] },
    sections: [
      { kind: "verse", startBeat: 0, endBeat: 32, confidence: 0.9 },
      { kind: "build", startBeat: 32, endBeat: 64, confidence: 0.9 },
      { kind: "chorus", startBeat: 64, endBeat: 128, confidence: 0.9 },
    ],
    musicalEvents: [
      { type: "build-start", beat: 32, endBeat: 64, confidence: 0.9 },
      { type: "drop", beat: 64, confidence: 0.95, strength: 0.9 },
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
  } as TrackModel;
}

describe("T-PLAN-13 layer tags (spec 33)", () => {
  it("tags every cue with a spec 33 layer matching the shared spelling", () => {
    const { plan } = compileShow({ track: model(), venue: DEFAULT_VENUE_CLASS, style: BUILT_IN_STYLES["club"]!, config: DEFAULT_CONFIG });
    for (const c of plan.cues) {
      expect(isPlanLayer(c.layer)).toBe(true);
      expect(c.layer).toBe(layerForCueName(c.type));
    }
    const layers = new Set(plan.cues.map((c) => c.layer));
    expect(layers.has("base")).toBe(true);
    expect(layers.has("exclusive")).toBe(true);
  });
  it("carries mix hints: intro/outro regions, incoming palette, exclusive impact beats", () => {
    const { plan } = compileShow({ track: model(), venue: DEFAULT_VENUE_CLASS, style: BUILT_IN_STYLES["club"]!, config: DEFAULT_CONFIG });
    for (const s of plan.sections) {
      expect(s.mixHints.introBeats).toBeGreaterThan(0);
      expect(s.mixHints.outroBeats).toBeGreaterThan(0);
      expect(s.mixHints.incomingPalette.length).toBeGreaterThan(0);
    }
    expect(plan.sections.flatMap((s) => s.mixHints.exclusiveImpactBeats)).toContain(64);
  });
});
