import { describe, expect, it } from "vitest";
import { trackModelSchema, type TrackModel } from "@autolight/contracts";
import { compileShow } from "./compile.js";
import { DEFAULT_CONFIG } from "./config.js";
import { BUILT_IN_STYLES } from "./styles.js";
import { DEFAULT_VENUE_CLASS } from "./types.js";
import { validateCompiledPlan } from "./validate.js";
import { assertCueLevelAttributes } from "./hierarchy.js";
import type { CompiledShowPlan, PlanCue } from "./types.js";

assertCueLevelAttributes();

interface FixtureSpec {
  id: string;
  durationSeconds: number;
  sections: TrackModel["sections"];
  musicalEvents: TrackModel["musicalEvents"];
}

// A grid that actually spans the fixture's sections and events: the previous
// single-beat grids were schema-invalid (events beyond the span+64 grace) and
// only passed because the fixtures cast the type away (batch-49).
function gridSpanning(maxBeat: number): TrackModel["beatGrid"] {
  const beatMs = (60 / 128) * 1000;

  return {
    version: 1,
    beats: Array.from({ length: maxBeat + 8 }, (_, i) => ({
      index: i,
      beatInBar: ((i % 4) + 1) as 1 | 2 | 3 | 4,
      sourceTimeMs: i * beatMs,
      bpm: 128,
    })),
  };
}

// One schema-validated factory for every fixture: trackModelSchema.parse is
// the contract check, so a required-field change breaks here instead of being
// silently absorbed by a cast, and the shared body lives once (batch-49).
function makeTrackModel(spec: FixtureSpec): TrackModel {
  const span = Math.max(...spec.sections.map((s) => s.endBeat), ...spec.musicalEvents.map((e) => e.beat));

  return trackModelSchema.parse({
    schemaVersion: 2,
    analyzerVersion: "t",
    identity: { id: spec.id, sourceIds: {} },
    durationSeconds: spec.durationSeconds,
    beatGrid: gridSpanning(span),
    sections: spec.sections,
    musicalEvents: spec.musicalEvents,
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
}

function futureTrack(): TrackModel {
  return makeTrackModel({
    id: "future",
    durationSeconds: 600,
    sections: [
      { kind: "verse", startBeat: 192, endBeat: 225, confidence: 0.9 },
      { kind: "build", startBeat: 225, endBeat: 257, confidence: 0.9 },
      { kind: "chorus", startBeat: 257, endBeat: 289, confidence: 0.9 },
    ],
    musicalEvents: [
      { type: "build-start", beat: 225, endBeat: 257, confidence: 0.9 },
      { type: "drop", beat: 257, confidence: 0.95 },
    ],
  });
}

function wideTrack(): TrackModel {
  return makeTrackModel({
    id: "wide",
    durationSeconds: 400,
    sections: [
      { kind: "verse", startBeat: 0, endBeat: 64, confidence: 0.9 },
      { kind: "build", startBeat: 64, endBeat: 96, confidence: 0.9 },
      { kind: "drop", startBeat: 96, endBeat: 128, confidence: 0.9 },
      { kind: "chorus", startBeat: 128, endBeat: 192, confidence: 0.9 },
    ],
    musicalEvents: [
      { type: "build-start", beat: 64, endBeat: 96, confidence: 0.9 },
      { type: "drop", beat: 96, confidence: 0.95 },
    ],
  });
}

describe("T-PLAN-03 hierarchy (P-2.1, P-2.4, P-30)", () => {
  it("stages the build from future knowledge with increasing density and darkness ending at the impact", () => {
    const track = futureTrack();
    const build = track.sections.find((s) => s.kind === "build");

    expect(build).toBeDefined();
    // Section bounds, not literals: the fixture owns where the build starts
    // and ends (batch-49).
    const buildStart = build!.startBeat;
    const buildEnd = build!.endBeat;
    const { plan } = compileShow({
      track,
      venue: DEFAULT_VENUE_CLASS,
      style: BUILT_IN_STYLES["festival"]!,
      config: DEFAULT_CONFIG,
    });

    const staged = plan.cues.filter((c) => c.startBeat >= buildStart && c.startBeat < buildEnd);

    expect(staged.length).toBeGreaterThanOrEqual(4);

    const ramps = staged
      .filter((c) => c.type === "build-ramp")
      .sort((a, b) => a.startBeat - b.startBeat);

    expect(ramps.length).toBeGreaterThanOrEqual(3);

    // "Increasing density": intensity never decreases across the ramp.
    for (let i = 1; i < ramps.length; i++) {
      expect(ramps[i]!.intensity).toBeGreaterThanOrEqual(ramps[i - 1]!.intensity);
    }

    const dark = plan.cues
      .filter((c) => c.type === "blackout" && c.startBeat + c.durationBeats <= buildEnd && c.startBeat >= buildStart)
      .sort((a, b) => b.startBeat - a.startBeat)[0];

    expect(dark).toBeDefined();
    expect(dark!.startBeat + dark!.durationBeats).toBe(buildEnd);
    expect(plan.cues.some((c) => c.reason.includes("foreshadowing"))).toBe(true);
  });

  it("schedules the five cue levels a modern style emits (track is declared, not emitted)", () => {
    const { plan } = compileShow({
      track: wideTrack(),
      venue: DEFAULT_VENUE_CLASS,
      style: BUILT_IN_STYLES["festival"]!,
      config: DEFAULT_CONFIG,
    });

    const levels = new Set(plan.cues.map((c) => c.level));

    // CUE_LEVELS declares six; no style emits a track-level cue yet, so this
    // test names exactly what the planner produces instead of claiming a
    // level no code path can satisfy (batch-49).
    for (const l of ["section", "phrase", "bar", "beat", "sub-beat"] as const) {
      expect(levels.has(l)).toBe(true);
    }
  });

  it("rejects a cue that changes a forbidden attribute at its level", () => {
    const { plan } = compileShow({
      track: wideTrack(),
      venue: DEFAULT_VENUE_CLASS,
      style: BUILT_IN_STYLES["club"]!,
      config: DEFAULT_CONFIG,
    });

    // Typed, not cast: the violation under test is the level, so the cue
    // must be a well-formed PlanCue that only the hierarchy check rejects
    // (batch-49).
    const badCue: PlanCue = {
      id: "cue-bad",
      type: "pulse",
      startBeat: 10,
      durationBeats: 0.5,
      intensity: 0.5,
      target: "PRIMARY",
      priority: 60,
      level: "section",
      layer: "base",
      reason: "forbidden level",
    };
    const bad: CompiledShowPlan = { ...plan, cues: [...plan.cues, badCue] };

    const problems = validateCompiledPlan(bad, 400, DEFAULT_CONFIG);
    expect(problems.some((p) => p.includes("level violation"))).toBe(true);
  });
});
