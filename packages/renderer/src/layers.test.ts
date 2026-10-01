import { describe, expect, it } from "vitest";
import type { Fixture, ShowCue, ShowPlan } from "@autolight/contracts";
import { makeFixture } from "@autolight/simulator";
import { frameHash, renderFrame } from "./index.js";
import {
  ADD_CEILING,
  LAYER_ORDER,
  compositeLayers,
  layerForCue,
  linearToSrgbByte,
  scaleLinear,
  srgbByteToLinear,
  type Contribution,
  type LayerContribution,
  type RenderLayer,
} from "./layers.js";

// P-2.5-partial-darkness: darkness is a state, not a brightness comparison. A
// LEFT blackout over an ALL look turns exactly the LEFT cells black.
// P-33-layer-stack: manual override beats exclusive impact beats accents;
// master intensity scales last; every blend mode has a golden frame.

const cue = (over: Partial<ShowCue> & Pick<ShowCue, "type">): ShowCue => ({
  startBeat: 0,
  durationBeats: 16,
  intensity: 1,
  target: "ALL",
  priority: 10,
  ...over,
});

const plan = (cues: ShowCue[]): ShowPlan => ({
  schemaVersion: 1,
  plannerVersion: "x",
  trackId: "t",
  styleId: "s",
  seed: "a",
  cues,
});

function contribution(color: [number, number, number], alpha: number, blend: Contribution["blend"]): Contribution {
  return {
    color: [srgbByteToLinear(color[0]), srgbByteToLinear(color[1]), srgbByteToLinear(color[2])],
    alpha,
    blend,
  };
}

function layer(name: RenderLayer, cells: Record<string, Contribution>): LayerContribution {
  return { layer: name, cells: new Map(Object.entries(cells)) };
}

const GREY = 128;
const fixtures: Fixture[] = [makeFixture("left", 2, 0, 0.4), makeFixture("right", 2, 0.6, 1)];

describe("darkness and the layer stack (P-2.5, P-33)", () => {
  it("turns exactly the LEFT cells black under an ALL look (P-2.5)", () => {
    const frames = renderFrame(
      plan([
        cue({ type: "section-look", target: "ALL", intensity: 1 }),
        cue({ type: "blackout", target: "LEFT", intensity: 0, priority: 95, durationBeats: 4 }),
      ]),
      1,
      fixtures,
    );
    expect([...frames.get("left")!]).toEqual(new Array(6).fill(0));
    expect([...frames.get("right")!].some((v) => v > 0)).toBe(true);
    // The inverse target darkens the other side, never the whole room.
    const mirrored = renderFrame(
      plan([
        cue({ type: "section-look", target: "ALL", intensity: 1 }),
        cue({ type: "blackout", target: "RIGHT", intensity: 0, priority: 95, durationBeats: 4 }),
      ]),
      1,
      fixtures,
    );
    expect([...mirrored.get("left")!].some((v) => v > 0)).toBe(true);
    expect([...mirrored.get("right")!]).toEqual(new Array(6).fill(0));
  });

  it("expresses partial darkness as a dip, not as a lost cell (P-2.5)", () => {
    // One cell keeps the pre-T-REND-03 hue heuristic identical across frames.
    const single: Fixture[] = [makeFixture("solo", 1, 0, 0)];
    const lit = renderFrame(plan([cue({ type: "section-look", intensity: 1 })]), 1, single);
    const dipped = renderFrame(
      plan([
        cue({ type: "section-look", intensity: 1 }),
        cue({ type: "dip", intensity: 0.25, priority: 60, durationBeats: 2 }),
      ]),
      1,
      single,
    );
    const litBytes = [...lit.get("solo")!];
    const dippedBytes = [...dipped.get("solo")!];
    expect(litBytes.some((v) => v > 0)).toBe(true);
    dippedBytes.forEach((value, index) => {
      expect(value).toBeLessThan(litBytes[index]!);
      expect(value).toBeGreaterThan(0);
    });
  });

  it("composites manual over exclusive over accents, master last (P-33)", () => {
    const accents = layer("accents", { c: contribution([255, 255, 255], 0.4, "over") });
    const exclusive = layer("exclusive", { c: contribution([255, 255, 255], 0.8, "over") });
    const manual = layer("manual", { c: contribution([0, 0, 0], 1, "replace") });

    // Order-insensitive input: the stack is always applied in spec 33 order.
    const stacked = compositeLayers([manual, exclusive, accents]);
    expect(stacked.get("c")).toEqual([0, 0, 0]);

    const withoutManual = compositeLayers([exclusive, accents]);
    expect(withoutManual.get("c")![0]).toBeCloseTo(0.88, 6);

    const half = compositeLayers([exclusive, accents]);
    scaleLinear(half, 0.5);
    expect(half.get("c")![0]).toBeCloseTo(0.44, 6);
    // A manual white layer replaces the stack, and master scales that too.
    const manualWhite = compositeLayers([layer("manual", { c: contribution([255, 255, 255], 1, "replace") }), exclusive]);
    expect(manualWhite.get("c")).toEqual([1, 1, 1]);
    scaleLinear(manualWhite, 0.5);
    expect(manualWhite.get("c")).toEqual([0.5, 0.5, 0.5]);
  });

  it("applies the manual override layer over the whole frame (P-33)", () => {
    const whiteHit = plan([cue({ type: "white-hit", target: "ALL", durationBeats: 1, priority: 100 })]);
    const plain = renderFrame(whiteHit, 0.5, fixtures);
    const blackedOut = renderFrame(whiteHit, 0.5, fixtures, { manual: { color: [0, 0, 0], intensity: 1 } });
    expect([...blackedOut.get("left")!]).toEqual(new Array(6).fill(0));
    expect([...blackedOut.get("right")!]).toEqual(new Array(6).fill(0));
    expect(frameHash(blackedOut)).not.toBe(frameHash(plain));

    const manualWhite = renderFrame(whiteHit, 0.5, fixtures, { manual: { color: [255, 255, 255], intensity: 1 } });
    const cells = [...manualWhite.get("left")!];
    expect(cells.every((v) => v === cells[0])).toBe(true);
    expect(cells[0]!).toBe(255);

    // Master intensity scales the composited frame, manual layer included.
    const half = renderFrame(whiteHit, 0.5, fixtures, {
      manual: { color: [255, 255, 255], intensity: 1 },
      masterIntensity: 0.5,
    });
    const byte = half.get("left")![0]!;
    expect(byte).toBeGreaterThan(180);
    expect(byte).toBeLessThan(192);
    expect(frameHash(half)).not.toBe(frameHash(manualWhite));
  });

  it("has a golden frame for every blend mode (P-33)", () => {
    const cases: { mode: Contribution["blend"]; layers: LayerContribution[]; expected: number }[] = [
      { mode: "over", layers: [layer("base", { c: contribution([255, 255, 255], 0.5, "over") })], expected: 186 },
      { mode: "replace", layers: [layer("base", { c: contribution([GREY, GREY, GREY], 1, "replace") })], expected: GREY },
      {
        mode: "multiply",
        layers: [
          layer("base", { c: contribution([255, 255, 255], 1, "replace") }),
          layer("exclusive", { c: contribution([GREY, GREY, GREY], 1, "multiply") }),
        ],
        expected: GREY,
      },
      { mode: "add", layers: [layer("accents", { c: contribution([255, 255, 255], 0.6, "add") })], expected: 202 },
      {
        mode: "max",
        layers: [
          layer("base", { c: contribution([255, 255, 255], 0.2, "max") }),
          layer("exclusive", { c: contribution([255, 255, 255], 0.8, "max") }),
        ],
        expected: 230,
      },
    ];
    for (const testCase of cases) {
      const composed = compositeLayers(testCase.layers);
      const byte = linearToSrgbByte(composed.get("c")![0]);
      expect(Math.abs(byte - testCase.expected), testCase.mode).toBeLessThanOrEqual(1);
    }
    // add never exceeds its ceiling.
    const ceiling = compositeLayers([
      layer("base", { c: contribution([255, 255, 255], 1, "replace") }),
      layer("exclusive", { c: contribution([255, 255, 255], 1, "add") }),
    ]);
    expect(ceiling.get("c")![0]).toBeLessThanOrEqual(ADD_CEILING);
    expect(LAYER_ORDER).toEqual(["base", "spatial", "rhythm", "accents", "exclusive", "reactive", "manual", "master"]);
    expect(layerForCue(cue({ type: "white-hit" }))).toBe("exclusive");
    expect(layerForCue(cue({ type: "chase-flip" }))).toBe("spatial");
  });

  it("keeps the whole room dark for an ALL blackout", () => {
    const frames = renderFrame(
      plan([cue({ type: "blackout", target: "ALL", intensity: 0, priority: 95, durationBeats: 4 })]),
      1,
      fixtures,
    );
    expect([...frames.get("left")!]).toEqual(new Array(6).fill(0));
    expect([...frames.get("right")!]).toEqual(new Array(6).fill(0));
  });
});
