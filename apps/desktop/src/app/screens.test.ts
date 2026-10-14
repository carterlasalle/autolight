import { describe, expect, it } from "vitest";
import { rowForTrack, inspectorLanes } from "../features/library/library.js";
import { tileForFixture, nextSetupStep, SETUP_STEPS } from "../features/venue/venue.js";
import { trackModelSchema, type TrackModel } from "@autolight/contracts";

const modelLiteral = {
  schemaVersion: 2, analyzerVersion: "t",
  identity: { id: "t1", sourceIds: {}, title: "Track", artist: "Artist" },
  durationSeconds: 200,
  beatGrid: { version: 1, beats: [{ index: 0, beatInBar: 1, sourceTimeMs: 0, bpm: 128 }] },
  sections: [{ kind: "chorus", startBeat: 0, endBeat: 32, confidence: 0.9 }],
  musicalEvents: [{ type: "drop", beat: 32, confidence: 0.9 }],
  analysisCoverage: "structured",
  readinessLevel: "structured",
  analysisCoverage2: {
    level: "structured",
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
};

// Parse through the contract schema instead of casting: the fixture stays
// honest to the real TrackModel (unknown keys and wrong enum shapes fail).
const model: TrackModel = trackModelSchema.parse(modelLiteral);

describe("desktop screens", () => {
  it("grades library readiness", () => {
    expect(rowForTrack(null, false, false).status).toBe("NEEDS ANALYSIS");
    expect(rowForTrack(model, false, false).status).toBe("READY");
    expect(rowForTrack(model, true, false).status).toBe("GRID WARNING");
    expect(rowForTrack(model, false, true).status).toBe("SOURCE MISSING");
    // The warning status also holds for a model carrying a real warning
    // record, not just a bare caller flag.
    const warned = trackModelSchema.parse({
      ...modelLiteral,
      gridWarnings: [{
        source: "beat-this", medianOffsetMs: 80, p95OffsetMs: 120, driftMs: 10,
        evidence: ["beat-this:offset-median-80ms"], beatRange: [1, 320], segments: [],
      }],
    });

    expect(rowForTrack(warned, true, false).status).toBe("GRID WARNING");
  });
  it("builds inspector lanes", () => {
    const lanes = inspectorLanes(model);
    expect(lanes.map((l) => l.name)).toEqual(["sections", "events", "grid"]);
    // The lane beats are the actual contract: kinds, type@beat, indexes.
    expect(lanes[0]?.beats).toEqual(["chorus"]);
    expect(lanes[1]?.beats).toEqual(["drop@32"]);
    expect(lanes[2]?.beats).toEqual([0]);
  });
  it("tiles fixtures with health", () => {
    const tile = tileForFixture(
      { id: "f1", adapter: "govee", sku: "H6076", hardwareId: "h", cells: [{ index: 0, position: { x: 0, y: 0 }, order: 0, tags: [] }], calibration: null },
      { fps: 30, sent: 100, superseded: 5, latencyMs: 25, health: "online", ip: "10.0.0.2" },
    );

    expect(tile.segments).toBe(1);
    expect(tile.health).toBe("online");
    // The null-calibration branch is the fallback under test.
    expect(tile.firmware).toBe("unknown");
  });
  it("walks setup to ready", () => {
    expect(nextSetupStep([])).toBe("dj");
    // The full list comes from the exported constant, so a new step cannot
    // slip between a hardcoded test copy and the real sequence.
    expect(nextSetupStep([...SETUP_STEPS])).toBe("ready");
  });
});
