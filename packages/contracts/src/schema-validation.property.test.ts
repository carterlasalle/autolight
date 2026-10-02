import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  beatToSourceSeconds,
  deckStateSchema,
  showPlanSchema,
  sourceSecondsToBeat,
  trackModelSchema,
  type BeatGrid,
} from "./index.js";
const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "test-fixtures", "analysis");

// T-QA-12 contract validation properties (T-DATA-05).
// Invalid objects of each kind must be rejected with a precise error path.
// A schema that silently strips unknown fields or accepts an empty grid for
// a level that needs beats fails below.

function grid(beats: number): BeatGrid {
  return {
    version: 1,
    beats: Array.from({ length: beats }, (_, i) => ({
      index: i, beatInBar: ((i % 4) + 1) as 1 | 2 | 3 | 4, sourceTimeMs: i * 468.75, bpm: 128,
    })),
  };
}

const goodDeck = {
  source: "rekordbox", deckId: 1, track: { id: "t", sourceIds: {} }, playing: true,
  playheadSeconds: 1, playRate: 1, effectiveBpm: 128,
  loop: { active: false, startSeconds: null, endSeconds: null, beatLength: null },
  channelFader: 0.8, crossfader: 0.5, master: true, receivedAtNs: 0n,
} as const satisfies {
  source: "rekordbox"; deckId: number; track: { id: string; sourceIds: Record<string, never> };
  playing: boolean; playheadSeconds: number; playRate: number; effectiveBpm: number;
  loop: { active: boolean; startSeconds: null; endSeconds: null; beatLength: null };
  channelFader: number; crossfader: number; master: boolean; receivedAtNs: bigint;
};
describe("contract validation properties", () => {
  it("rejects out-of-range faders and bad enums", () => {
    for (const bad of [
      { ...goodDeck, channelFader: 9 },
      { ...goodDeck, channelFader: -0.1 },
      { ...goodDeck, crossfader: 2 },
      { ...goodDeck, source: "cdj" },
      { ...goodDeck, playRate: Number.NaN },
    ]) {
      const r = deckStateSchema.safeParse(bad);
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error.issues.length).toBeGreaterThan(0);
    }
    expect(deckStateSchema.safeParse(goodDeck).success).toBe(true);
  });

  it("rejects bad sections, events, and coverage levels", () => {
    const inputs = {
      "source.audio": { status: "present" },
      "native.rekordbox.grid": { status: "present" },
      "native.rekordbox.pssi": { status: "present" },
      "native.rekordbox.cues": { status: "absent" },
      "native.rekordbox.waveforms": { status: "absent" },
      "native.rekordbox.vocal": { status: "absent" },
      "native.serato.grid": { status: "absent" },
      "native.serato.markers": { status: "absent" },
      "ml.allinone.structure": { status: "present" },
      "ml.allinone.metrical": { status: "absent" },
      "ml.allinone.activations": { status: "absent" },
      "ml.allinone.embeddings": { status: "absent" },
      "ml.stems": { status: "absent" },
      "ml.beatthis": { status: "absent" },
      "dsp.features": { status: "present" },
      "dsp.stemProxies": { status: "absent" },
      "events.detectors": { status: "present" },
      "fusion.structure": { status: "present" },
      "plan.generated": { status: "present" },
    };
    const model = {
      schemaVersion: 2, analyzerVersion: "t", identity: { id: "t", sourceIds: {} },
      durationSeconds: 200, beatGrid: grid(64),
      sections: [{ kind: "build", startBeat: 0, endBeat: 16, confidence: 0.9, evidence: ["rekordbox:PSSI:Up"] }],
      musicalEvents: [{ type: "drop", beat: 16, confidence: 0.9, evidence: ["energy:peak"] }],
      analysisCoverage: "full",
      readinessLevel: "full",
      analysisCoverage2: { level: "full", inputs },
      gridWarnings: [],
      beatFeatures: [{ beat: 1, rms: 0.5 }],
      phrases: [{ kind: "build", rawLabel: "Up", startBeat: 0, endBeat: 16, confidence: 0.9, mood: 1, bank: 1, fill: false, raw: { kind: 2, k1: 0, k2: 0, k3: 0 } }],
      frameFeatures: { artifactPath: "/tmp/x.features.json", stemSource: "dsp.stemProxies", activationFps: 10 },
      musicalKey: { key: "A", mode: "minor", confidence: 0.8 },
      tempo: 128,
      nativeAnalysis: {
        rekordbox: {
          cues: [],
          waveformFlags: { hasWaveform: true, hasColorWaveform: false, has3Band: false, hasVocals: false },
          outcomes: [{ tag: "PQTZ", file: "ANLZ0000.DAT", status: "ok" }],
        },
      },
    };
    expect(trackModelSchema.safeParse(model).success).toBe(true);
    expect(trackModelSchema.safeParse({ ...model, analysisCoverage: "nope" }).success).toBe(false);
    expect(trackModelSchema.safeParse({
      ...model, sections: [{ kind: "nope", startBeat: 0, endBeat: 1, confidence: 1 }],
    }).success).toBe(false);
    expect(trackModelSchema.safeParse({
      ...model, musicalEvents: [{ type: "nope", beat: 1, confidence: 1 }],
    }).success).toBe(false);
    expect(trackModelSchema.safeParse({ ...model, beatGrid: { version: 1, beats: [] } }).success).toBe(false);
    expect(trackModelSchema.safeParse({ ...model, schemaVersion: 1 }).success).toBe(false);
    expect(trackModelSchema.safeParse({ ...model, extraField: 1 }).success).toBe(false);
    const { ["plan.generated"]: _dropped, ...shortInputs } = inputs;
    expect(trackModelSchema.safeParse({
      ...model, analysisCoverage2: { level: "full", inputs: shortInputs },
    }).success).toBe(false);
    expect(trackModelSchema.safeParse({
      ...model, analysisCoverage: "adaptive", beatGrid: grid(4),
    }).success).toBe(false);
    expect(trackModelSchema.safeParse({
      ...model, analysisCoverage: "adaptive", beatGrid: { version: 1, beats: [] },
    }).success).toBe(true);
  });
  it("parses the v2 parity fixture both sides agree on (T-ANA-12 P-20)", () => {
    const raw = readFileSync(join(fixtureDir, "trackmodel-v2.fixture.json"), "utf8");
    const parsed = trackModelSchema.safeParse(JSON.parse(raw));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(JSON.stringify(parsed.data)).toBe(JSON.stringify(JSON.parse(raw)));
    }
  });

  it("accepts a well-formed plan and rejects a bad cue", () => {
    const plan = {
      schemaVersion: 1, plannerVersion: "0.1.0", trackId: "t", styleId: "s", seed: "00",
      cues: [{ type: "section-look", startBeat: 0, durationBeats: 16, intensity: 0.8, target: "PRIMARY", priority: 1 }],
    };
    expect(showPlanSchema.safeParse(plan).success).toBe(true);
    expect(showPlanSchema.safeParse({ ...plan, cues: [] }).success).toBe(true);
    expect(showPlanSchema.safeParse({
      ...plan, cues: [{ type: "", startBeat: 0, durationBeats: -1, intensity: 9, target: "", priority: 1 }],
    }).success).toBe(false);
  });

  it("maps a dropout grid without NaN or inversion", () => {
    const g = grid(128);
    let prev = -Infinity;
    for (let s = 0; s < 60; s += 0.1) {
      const b = sourceSecondsToBeat(g, s);
      expect(Number.isFinite(b)).toBe(true);
      expect(b).toBeGreaterThanOrEqual(prev);
      prev = b;
      expect(Math.abs(beatToSourceSeconds(g, Math.min(127, b)) - s)).toBeLessThan(0.5);
    }
  });
});
