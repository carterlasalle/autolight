// T-PLAN-11: corrections, locks and regeneration (P-97).
import { describe, expect, it } from "vitest";
import type { TrackModel } from "@autolight/contracts";
import { compileShow } from "./compile.js";
import { DEFAULT_CONFIG } from "./config.js";
import { applyEdits, cueId, regenerateWithLocks } from "./corrections.js";
import { BUILT_IN_STYLES } from "./styles.js";
import { DEFAULT_VENUE_CLASS, EMPTY_EDITS } from "./types.js";

function model(): TrackModel {
  const m: TrackModel = {
    schemaVersion: 2, analyzerVersion: "t", identity: { id: "corr", sourceIds: {} },
    durationSeconds: 400,
    beatGrid: { version: 1, beats: [{ index: 0, beatInBar: 1, sourceTimeMs: 0, bpm: 128 }] },
    sections: [
      { kind: "verse", startBeat: 0, endBeat: 32, confidence: 0.9 },
      { kind: "build", startBeat: 32, endBeat: 64, confidence: 0.9 },
      { kind: "chorus", startBeat: 64, endBeat: 96, confidence: 0.9 },
    ],
    musicalEvents: [{ type: "drop", beat: 64, confidence: 0.95, strength: 0.9 }],
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
  };

  return m;
}

describe("T-PLAN-11 corrections (P-97)", () => {
  it("derives stable ids from seed, section, level and ordinal", () => {
    expect(cueId("seed", 1, "beat", 3)).toBe(cueId("seed", 1, "beat", 3));
    expect(cueId("seed", 1, "beat", 3)).not.toBe(cueId("seed", 2, "beat", 3));
    expect(cueId("seed", 1, "beat", 3)).not.toBe(cueId("other", 1, "beat", 3));
    expect(cueId("seed", 1, "beat", 3)).not.toBe(cueId("seed", 1, "bar", 3));
    expect(cueId("seed", 1, "beat", 3)).not.toBe(cueId("seed", 1, "beat", 4));
  });
  it("regenerating a middle section keeps every cue id outside it", () => {
    const { plan } = compileShow({ track: model(), venue: DEFAULT_VENUE_CLASS, style: BUILT_IN_STYLES["club"]!, config: DEFAULT_CONFIG });
    const before = new Map(plan.cues.filter((c) => c.startBeat < 32 || c.startBeat >= 64).map((c) => [c.id, c.startBeat]));
    const fresh = plan.cues.filter((c) => c.startBeat >= 32 && c.startBeat < 64).map((c) => ({ ...c, intensity: 0.1 }));
    const { cues } = regenerateWithLocks({ plan, sectionStart: 32, sectionEnd: 64, fresh, edits: { ...EMPTY_EDITS, lockedRegions: [{ startBeat: 0, endBeat: 32 }, { startBeat: 64, endBeat: 96 }] } });

    for (const [id, beat] of before) {
      const kept = cues.find((c) => c.id === id);
      expect(kept, id).toBeDefined();
      expect(kept!.startBeat).toBe(beat);
    }

    // The middle section must actually regenerate: fresh cues land with the
    // new intensity, and the loop must have had outside cues to preserve.
    expect(before.size).toBeGreaterThan(0);

    for (const c of fresh) {
      const landed = cues.find((k) => k.id === c.id);
      expect(landed, c.id).toBeDefined();
      expect(landed!.intensity).toBe(0.1);
    }
  });
  it("locks survive, deletions stick, and stale edits are reported on upgrade", () => {
    const { plan } = compileShow({ track: model(), venue: DEFAULT_VENUE_CLASS, style: BUILT_IN_STYLES["club"]!, config: DEFAULT_CONFIG });
    const victim = plan.cues.find((c) => c.startBeat >= 32 && c.startBeat < 64)!;
    // Lock region 0-96 spans whole cues, so the full-span coverage predicate
    // (startBeat + durationBeats <= endBeat, matching inLockedRegion) counts
    // it as applied; the 500-600 region covers nothing and is reported.
    const edits = { ...EMPTY_EDITS, lockedRegions: [{ startBeat: 0, endBeat: 96 }], deletedCueIds: [victim.id] };
    // Re-add the victim via fresh: only the deletion logic can remove it, so a
    // regression that ignores deletedCueIds fails here.
    const r = regenerateWithLocks({ plan, sectionStart: 32, sectionEnd: 64, fresh: [{ ...victim }], edits });
    expect(r.cues.some((c) => c.id === victim.id)).toBe(false);
    expect(r.droppedFresh).toContain(victim.id);
    expect(r.cues.some((c) => c.startBeat < 32)).toBe(true);
    const rep = applyEdits(r.cues, { ...edits, lockedRegions: [{ startBeat: 0, endBeat: 96 }, { startBeat: 500, endBeat: 600 }] });
    expect(rep.applied).toBeGreaterThan(0);
    expect(rep.noLongerApply.some((x) => x.includes("500-600"))).toBe(true);
  });
  it("reconciles pinned cues: present pins apply, absent pins are reported", () => {
    const { plan } = compileShow({ track: model(), venue: DEFAULT_VENUE_CLASS, style: BUILT_IN_STYLES["club"]!, config: DEFAULT_CONFIG });
    const present = plan.cues[0]!;
    const absent = { ...present, id: "cue-missing" };
    const rep = applyEdits(plan.cues, { ...EMPTY_EDITS, pinnedCues: [present, absent] });
    expect(rep.applied).toBe(1);
    expect(rep.noLongerApply.some((x) => x.includes("cue-missing"))).toBe(true);
  });
});
