// T-PLAN-01: ShowPlan v2, typed cues, spatial selectors (spec 26/27/32/72/73/75).
import { describe, expect, it } from "vitest";
import type { TrackModel } from "@autolight/contracts";
import { compileShow } from "./compile.js";
import { DEFAULT_CONFIG } from "./config.js";
import { BUILT_IN_STYLES } from "./styles.js";
import {
  DEFAULT_VENUE_CLASS,
  isCueLevel,
  isPlanLayer,
  selectorHasDeviceRef,
  stringHasDeviceRef,
  trackFingerprint,
  type CompiledShowPlan,
  type PlanCue,
} from "./types.js";

function model(over: Partial<TrackModel> = {}): TrackModel {
  return {
    schemaVersion: 2,
    analyzerVersion: "t",
    identity: { id: "trk1", sourceIds: {} },
    durationSeconds: 200,
    beatGrid: { version: 1, beats: [{ index: 0, beatInBar: 1, sourceTimeMs: 0, bpm: 128 }] },
    sections: [
      { kind: "build", startBeat: 32, endBeat: 64, confidence: 0.9 },
      { kind: "chorus", startBeat: 64, endBeat: 96, confidence: 0.9 },
    ],
    musicalEvents: [
      { type: "build-start", beat: 32, endBeat: 64, confidence: 0.9 },
      { type: "drop", beat: 64, confidence: 0.95 },
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
    ...over,
  } as TrackModel;
}

const style = BUILT_IN_STYLES["club"]!;
const venue = DEFAULT_VENUE_CLASS;

function compile(track: TrackModel): CompiledShowPlan {
  return compileShow({ track, venue, style, config: DEFAULT_CONFIG }).plan;
}

describe("T-PLAN-01 plan schema (P-26, P-27, P-32, P-72, P-75)", () => {
  it("carries the spec 72 fields plus determinism, design, sections, recurrence and constraints", () => {
    const plan = compile(model());
    expect(plan.schemaVersion).toBe(1);
    expect(plan.plannerVersion).toBe("0.2.0");
    expect(plan.trackId).toBe("trk1");
    expect(plan.styleId).toBe("club");
    expect(plan.seed).toMatch(/^[0-9a-f]{8}$/);
    expect(plan.determinism.fingerprint).toBe("trk1");
    expect(plan.determinism.plannerVersion).toBe("0.2.0");
    expect(plan.globalDesign.primary.length).toBeGreaterThanOrEqual(2);
    expect(plan.sections).toHaveLength(2);
    expect(plan.recurrence.motifs.length).toBeGreaterThan(0);
    expect(plan.cues.length).toBeGreaterThan(0);
  });

  it("gives every cue a stable id, a level, a layer, a beat position, a reason and an envelope-capable shape", () => {
    const plan = compile(model());
    const ids = new Set(plan.cues.map((c) => c.id));
    expect(ids.size).toBe(plan.cues.length);
    for (const c of plan.cues) {
      expect(isCueLevel(c.level)).toBe(true);
      expect(isPlanLayer(c.layer)).toBe(true);
      expect(Number.isFinite(c.startBeat)).toBe(true);
      expect(c.reason.length).toBeGreaterThan(0);
    }
    const hitPlan = compileShow({ track: model(), venue, style: { ...style, whiteHitFrequency: 1 }, config: DEFAULT_CONFIG }).plan;
    const hit = hitPlan.cues.find((c) => c.type === "white-hit");
    expect(hit?.attack).toEqual({ kind: "ms", ms: 5 });
    expect(hit?.release).toEqual({ kind: "beats", beats: 0.5 });
  });

  it("is deterministic over the five inputs and changes when any one changes", () => {
    const track = model();
    const a = compile(track).seed;
    const b = compile(track).seed;
    expect(a).toBe(b);
    const otherTrack = compile(model({ identity: { id: "trk2", sourceIds: {} } })).seed;
    expect(otherTrack).not.toBe(a);
    const otherStyle = compileShow({
      track,
      venue,
      style: BUILT_IN_STYLES["dark"]!,
      config: DEFAULT_CONFIG,
    }).plan.seed;
    expect(otherStyle).not.toBe(a);
    const otherVenue = compileShow({
      track,
      venue: { ...venue, minFps: 30 },
      style,
      config: DEFAULT_CONFIG,
    }).plan.seed;
    expect(otherVenue).not.toBe(a);
    const otherConfig = compileShow({
      track,
      venue,
      style,
      config: { ...DEFAULT_CONFIG, whiteHitMinBeats: 24 },
    }).plan.seed;
    expect(otherConfig).not.toBe(a);
  });

  it("seeds from the fingerprint, so the same fingerprint with different DB ids gives the same plan", () => {
    const fp = "fingerprint-abc";
    const t1 = model({ identity: { id: "db-1", sourceIds: {}, pcmFingerprint: fp } });
    const t2 = model({ identity: { id: "db-2", sourceIds: {}, pcmFingerprint: fp } });
    expect(trackFingerprint(t1)).toEqual({ value: fp, source: "pcm" });
    expect(compile(t1).seed).toBe(compile(t2).seed);
    expect(compile(t1).determinism.fingerprintSource).toBe("pcm");
  });

  it("emits no device IDs in targets and no seconds fields in cue types", () => {
    const plan = compile(model());
    for (const c of plan.cues as PlanCue[]) {
      expect(stringHasDeviceRef(c.target)).toBe(false);
      if (c.selector) expect(selectorHasDeviceRef(c.selector)).toBe(false);
      expect("seconds" in c).toBe(false);
      expect("startSeconds" in c).toBe(false);
      expect("durationMs" in c).toBe(false);
    }
  });
});
