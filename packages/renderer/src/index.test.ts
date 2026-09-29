import { describe, expect, it } from "vitest";
import { renderFrame, frameHash } from "./index.js";
const plan = { schemaVersion: 1, plannerVersion: "x", trackId: "t", styleId: "s", seed: "a", cues: [
  { type: "impact", startBeat: 257, durationBeats: 2, intensity: 1, target: "ALL", priority: 90 },
  { type: "blackout", startBeat: 256, durationBeats: 1, intensity: 0, target: "ALL", priority: 100 },
]} as const;
const fixtures = [{ id: "f1", adapter: "govee", sku: "H6076", hardwareId: "h1",
  cells: [{ index: 0, position: { x: 0, y: 0 }, order: 0, tags: [] }], calibration: null }] as any;
describe("renderer", () => {
  it("blackout wins at beat 256", () => {
    const f = renderFrame(plan as any, 256.5, fixtures);
    expect([...f.get("f1")!]).toEqual([0, 0, 0]);
  });
  it("golden hash stable at beat 257", () => {
    expect(frameHash(renderFrame(plan as any, 257, fixtures))).toBe(frameHash(renderFrame(plan as any, 257, fixtures)));
  });
});
