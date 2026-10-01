import { describe, expect, it } from "vitest";
import { SPATIAL_PRIMITIVES, parsePrimitiveParams } from "../../show-planner/src/primitives.js";
import { envelopeLevel, sampleSpatial } from "./spatial.js";
import { referenceFrames } from "./goldens.js";
import { frameHash } from "./index.js";
import { computeFields } from "../../venue/src/fields.js";
import { fieldCellsForReference, REFERENCE_ROOMS, referenceById } from "../../venue/src/reference.js";

describe("T-REND-06 renderer goldens", () => {
  it("renders every spatial primitive without throwing and hashes deterministically", () => {
    const ref = referenceById("square-loop");
    const room = { ...ref.room, logicalZeroS: ref.zeroS, perimeterDirection: "clockwise" as const };
    const built = fieldCellsForReference(ref);
    const fields = computeFields(room, built.cells, ref.runs, { zeroS: ref.zeroS });
    const hashes: Record<string, string> = {};
    for (const name of SPATIAL_PRIMITIVES) {
      const shape = referenceFrames(name);
      const params = parsePrimitiveParams(name, shape.params);
      const levels = new Uint8Array(fields.count * 3);
      for (let i = 0; i < fields.count; i++) {
        const sample = sampleSpatial(name, params, shape.beat, i, fields);
        const env = envelopeLevel(shape.beat, 4, { attackBeats: 0.05, releaseBeats: 0.5 });
        const v = Math.round(Math.min(1, Math.max(0, sample.level * env)) * 255);
        levels[i * 3] = v;
        levels[i * 3 + 1] = Math.round(v * 0.6);
        levels[i * 3 + 2] = Math.round(v * 0.2);
      }
      const first = frameHash(new Map([["strip", levels]]));
      const second = frameHash(new Map([["strip", levels]]));
      expect(second).toBe(first);
      hashes[name] = first;
    }
    expect(Object.keys(hashes)).toHaveLength(SPATIAL_PRIMITIVES.length);
    expect(new Set(Object.values(hashes)).size).toBeGreaterThan(SPATIAL_PRIMITIVES.length - 3);
  });

  it("covers every reference room", () => {
    expect(REFERENCE_ROOMS.map((r) => r.id)).toEqual(
      expect.arrayContaining(["square-loop", "square-mirrored", "square-chunks", "club-rectangle", "l-room", "curved-room"]),
    );
  });
});
