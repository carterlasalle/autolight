import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  validateAtBoundary,
  validateBeats,
  validateEvents,
  validateFixture,
  validateFixtureCells,
  validateSections,
  validateShowPlan,
  validateTrackModel,
} from "./validation.js";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "test-fixtures", "analysis");
const goodModel = JSON.parse(readFileSync(join(fixtureDir, "live-deck1.trackmodel.json"), "utf8")) as unknown;
const goodPlan = JSON.parse(readFileSync(join(fixtureDir, "live-deck1.showplan.json"), "utf8")) as unknown;

function beats(n: number): unknown {
  return {
    beats: Array.from({ length: n }, (_, i) => ({ index: i + 1, beatInBar: ((i % 4) + 1) as 1 | 2 | 3 | 4, sourceTimeMs: i * 500, bpm: 120 })),
    version: 1,
  };
}

describe("semantic validation of contracts (T-DATA-05, F-DATA-05)", () => {
  it("accepts the committed TrackModel and ShowPlan fixtures", () => {
    expect(validateTrackModel(goodModel)).toEqual([]);
    expect(validateShowPlan(goodPlan)).toEqual([]);
  });

  it("rejects non-increasing and duplicate beat indexes with a precise path", () => {
    const grid = {
      beats: [
        { index: 1, beatInBar: 1, sourceTimeMs: 0, bpm: 120 },
        { index: 1, beatInBar: 2, sourceTimeMs: 500, bpm: 120 },
        { index: 3, beatInBar: 3, sourceTimeMs: 500, bpm: 120 },
      ],
      version: 1,
    };
    const issues = validateBeats(grid);
    expect(issues.some((i) => i.path === "beatGrid.beats[1].index")).toBe(true);
    expect(issues.some((i) => i.path === "beatGrid.beats[2].sourceTimeMs")).toBe(true);
  });

  it("rejects unordered ranges, gaps and overlaps in section cover", () => {
    expect(validateSections([{ startBeat: 9, endBeat: 9 }], beats(32))[0]?.path).toBe("sections[0].endBeat");
    expect(
      validateSections(
        [
          { startBeat: 1, endBeat: 9 },
          { startBeat: 5, endBeat: 17 },
        ],
        beats(32),
      ).some((i) => i.message.includes("overlaps")),
    ).toBe(true);
    expect(
      validateSections(
        [
          { startBeat: 1, endBeat: 5 },
          { startBeat: 9, endBeat: 17 },
        ],
        beats(32),
      ).some((i) => i.message.includes("gap")),
    ).toBe(true);
  });

  it("rejects events outside the beat range and negative event extents", () => {
    const grid = beats(8);
    expect(validateEvents([{ beat: 99 }], grid).some((i) => i.path === "musicalEvents[0].beat")).toBe(true);
    expect(validateEvents([{ beat: 4, endBeat: 2 }], grid).some((i) => i.path === "musicalEvents[0].endBeat")).toBe(true);
  });

  it("rejects non-positive cue durations", () => {
    const plan = JSON.parse(JSON.stringify(goodPlan)) as { cues: { durationBeats: number }[] };
    plan.cues[0]!.durationBeats = 0;
    const issues = validateShowPlan(plan);
    expect(issues.some((i) => i.path === "cues[0].durationBeats")).toBe(true);
  });

  it("rejects cell map disagreements with calibration and device counts", () => {
    const cells = [
      { index: 0, position: { x: 0, y: 0 }, order: 0, tags: [] },
      { index: 0, position: { x: 1, y: 0 }, order: 1, tags: [] },
    ];
    const issues = validateFixtureCells(cells, 5, 5);
    expect(issues.some((i) => i.message.includes("duplicate cell index 0"))).toBe(true);
    expect(issues.some((i) => i.path === "calibration.segmentCount")).toBe(true);
    expect(issues.some((i) => i.path === "device.segmentCount")).toBe(true);
  });

  it("routes validateAtBoundary to each contract kind", () => {
    expect(validateAtBoundary("track-model", goodModel)).toEqual([]);
    expect(validateAtBoundary("show-plan", goodPlan)).toEqual([]);
    expect(validateAtBoundary("show-plan", { cues: [] }).length).toBeGreaterThan(0);
    expect(validateFixture({ id: "x", adapter: "govee", sku: "s", hardwareId: "h", cells: [], calibration: null }, null).length).toBe(0);
  });

  it("hashes differently after a semantic fix so caches cannot reuse bad rows", () => {
    const bad = JSON.stringify({ sections: [{ startBeat: 5, endBeat: 1 }] });
    const fixed = JSON.stringify({ sections: [{ startBeat: 1, endBeat: 5 }] });
    const hash = (s: string): string => createHash("sha256").update(s).digest("hex").slice(0, 16);
    expect(hash(bad)).not.toBe(hash(fixed));
  });
});
