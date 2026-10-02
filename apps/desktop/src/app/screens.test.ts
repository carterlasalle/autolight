import { describe, expect, it } from "vitest";
import { rowForTrack, inspectorLanes } from "../features/library/library.js";
import { tileForFixture, nextSetupStep } from "../features/venue/venue.js";
import type { TrackModel } from "@autolight/contracts";

const model = {
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
} as unknown as TrackModel;

describe("desktop screens", () => {
  it("grades library readiness", () => {
    expect(rowForTrack(null, false, false).status).toBe("NEEDS ANALYSIS");
    expect(rowForTrack(model, false, false).status).toBe("READY");
    expect(rowForTrack(model, true, false).status).toBe("GRID WARNING");
    expect(rowForTrack(model, false, true).status).toBe("SOURCE MISSING");
  });
  it("builds inspector lanes", () => {
    const lanes = inspectorLanes(model);
    expect(lanes.map((l) => l.name)).toEqual(["sections", "events", "grid"]);
  });
  it("tiles fixtures with health", () => {
    const tile = tileForFixture(
      { id: "f1", adapter: "govee", sku: "H6076", hardwareId: "h", cells: [{ index: 0, position: { x: 0, y: 0 }, order: 0, tags: [] }], calibration: null },
      { fps: 30, sent: 100, superseded: 5, latencyMs: 25, health: "online", ip: "10.0.0.2" },
    );
    expect(tile.segments).toBe(1);
    expect(tile.health).toBe("online");
  });
  it("walks setup to ready", () => {
    expect(nextSetupStep([])).toBe("dj");
    expect(nextSetupStep(["dj", "controller", "library", "lights", "identify", "placement", "orientation", "qualification", "analysis", "preview"])).toBe("ready");
  });
});
