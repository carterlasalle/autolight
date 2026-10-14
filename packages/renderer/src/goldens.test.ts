import { describe, expect, it } from "vitest";
import { SPATIAL_PRIMITIVES, parsePrimitiveParams } from "@autolight/show-planner";
import { envelopeLevel, sampleSpatial } from "./spatial.js";
import { referenceFrames } from "./goldens.js";
import { frameHash } from "./index.js";
import { computeFields } from "@autolight/venue";
import { fieldCellsForReference, REFERENCE_ROOMS, referenceById } from "@autolight/venue";

describe("T-REND-06 renderer goldens", () => {
  it("renders every spatial primitive without throwing and hashes deterministically", () => {
    // Named envelope inputs: both passes below must use the same values for
    // the determinism claim to mean anything (batch-23).
    const ENVELOPE_BEATS = 4;
    const ENVELOPE = { attackBeats: 0.05, releaseBeats: 0.5 } as const;
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
        expect(Number.isFinite(sample.level), `${name} cell ${i} level`).toBe(true);
        const env = envelopeLevel(shape.beat, ENVELOPE_BEATS, ENVELOPE);
        expect(Number.isFinite(env), `${name} envelope`).toBe(true);
        const v = Math.round(Math.min(1, Math.max(0, sample.level * env)) * 255);
        levels[i * 3] = v;
        levels[i * 3 + 1] = Math.round(v * 0.6);
        levels[i * 3 + 2] = Math.round(v * 0.2);
      }

      const first = frameHash(new Map([["strip", levels]]));
      // Recompute the buffer from scratch so the pipeline (not just the hash) proves deterministic.
      const again = new Uint8Array(fields.count * 3);

      for (let i = 0; i < fields.count; i++) {
        const sample = sampleSpatial(name, params, shape.beat, i, fields);
        const env = envelopeLevel(shape.beat, ENVELOPE_BEATS, ENVELOPE);
        const v = Math.round(Math.min(1, Math.max(0, sample.level * env)) * 255);
        again[i * 3] = v;
        again[i * 3 + 1] = Math.round(v * 0.6);
        again[i * 3 + 2] = Math.round(v * 0.2);
      }

      expect(frameHash(new Map([["strip", again]]))).toBe(first);
      hashes[name] = first;
    }

    expect(Object.keys(hashes)).toHaveLength(SPATIAL_PRIMITIVES.length);
    expect(new Set(Object.values(hashes)).size).toBe(SPATIAL_PRIMITIVES.length);
  });

  it("covers every reference room", () => {
    expect(REFERENCE_ROOMS.map((r) => r.id)).toEqual([
      "square-loop",
      "square-mirrored",
      "square-chunks",
      "club-rectangle",
      "l-room",
      "curved-room",
    ]);
  });
});
