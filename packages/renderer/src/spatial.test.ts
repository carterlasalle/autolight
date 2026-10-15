import { describe, expect, it } from "vitest";
import type { VenueFields } from "@autolight/venue";
import { isKnownCueType, parsePrimitiveParams } from "@autolight/show-planner";
import { envelopeFromMs, envelopeLevel, sampleSpatial, UnknownSpatialError, type PrimitiveName } from "./spatial.js";

function ringFields(n: number): VenueFields {
  const keys: string[] = [];
  const pos = new Float32Array(n * 3);
  const extent = new Float32Array(n * 6);
  const uv = new Float32Array(n * 2);
  const h = new Float32Array(n);
  const s = new Float32Array(n);
  const theta = new Float32Array(n);
  const dCenter = new Float32Array(n);
  const dDj = new Float32Array(n);
  const gDj = new Float32Array(n);
  const wall = new Int16Array(n);
  const wallPos = new Float32Array(n);
  const corner = new Float32Array(n);
  const side = new Uint8Array(n);
  const frontBack = new Uint8Array(n);
  const chain = new Float32Array(n);
  const physical = new Uint32Array(n);
  const logical = new Uint32Array(n);
  const tangent = new Float32Array(n * 2);
  const signedSplit = new Float32Array(n);
  const maxDist = Math.hypot(5, 5);
  const dj = { x: 0, y: -2 };
  const djS = 0.875;

  const walls = [
    { ax: -2.5, ay: -2.5, bx: -2.5, by: 2.5 },
    { ax: -2.5, ay: 2.5, bx: 2.5, by: 2.5 },
    { ax: 2.5, ay: 2.5, bx: 2.5, by: -2.5 },
    { ax: 2.5, ay: -2.5, bx: -2.5, by: -2.5 },
  ];

  for (let i = 0; i < n; i++) {
    const d = ((i + 0.5) / n) * 20;
    const w = Math.min(3, Math.floor(d / 5));
    const t = (d - w * 5) / 5;
    const seg = walls[w]!;
    const x = seg.ax + (seg.bx - seg.ax) * t;
    const y = seg.ay + (seg.by - seg.ay) * t;
    const z = 2.5;
    keys.push(`strip:${i}`);
    pos[i * 3] = x;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = z;
    extent[i * 6] = x;
    extent[i * 6 + 1] = y;
    extent[i * 6 + 2] = z;
    extent[i * 6 + 3] = x;
    extent[i * 6 + 4] = y;
    extent[i * 6 + 5] = z;
    uv[i * 2] = (x + 2.5) / 5;
    uv[i * 2 + 1] = (y + 2.5) / 5;
    h[i] = z / 2.6;
    s[i] = d / 20;
    theta[i] = Math.atan2(y, x);
    dCenter[i] = Math.hypot(x, y) / maxDist;
    dDj[i] = Math.hypot(x - dj.x, y - dj.y) / maxDist;
    gDj[i] = Math.min(Math.abs(d / 20 - djS), 1 - Math.abs(d / 20 - djS)) * 2;
    wall[i] = w;
    wallPos[i] = t;
    corner[i] = Math.min(t, 1 - t) * 5;
    if (x < -0.375) side[i] = 0;
    else if (x > 0.375) side[i] = 2;
    else side[i] = 1;
    frontBack[i] = y >= 0 ? 1 : 0;
    chain[i] = i;
    physical[i] = i;
    logical[i] = i;
    const tx = (seg.bx - seg.ax) / 5;
    const ty = (seg.by - seg.ay) / 5;
    tangent[i * 2] = tx;
    tangent[i * 2 + 1] = ty;
    signedSplit[i] = x / maxDist;
  }

  return {
    version: 1, count: n, keys, pos, extent, uv, h, s, theta, dCenter, dDj, gDj,
    wall, wallPos, corner, side, frontBack, chain, physical, logical, tangent,
    signedSplit, perimeterLen: 20, maxDist,
  };
}

describe("T-REND-02 primitive renderers with envelopes", () => {
  it("moves the orbit head with s and wraps without a jump", () => {
    const fields = ringFields(30);
    const params = parsePrimitiveParams("Orbit", {});
    const at = (beat: number, i: number): number => sampleSpatial("Orbit", params, beat, i, fields).level;
    expect(at(0, 0)).toBeGreaterThan(at(0, 15));

    const headAt = (beat: number): number => {
      let best = 0;
      let bestV = -1;

      for (let i = 0; i < fields.count; i++) {
        const v = at(beat, i);

        if (v > bestV) { bestV = v; best = i; }
      }

      return best;
    };

    const h0 = headAt(0);
    const h1 = headAt(1);
    const jump = Math.min(Math.abs(h1 - h0), fields.count - Math.abs(h1 - h0));
    expect(jump).toBeGreaterThan(0);
    expect(jump).toBeLessThanOrEqual(10);
    // The wrap itself: a full revolution (default beatsPerRevolution 4)
    // returns the head to where it started, one step lands where beat 1 did.
    expect(headAt(4)).toBe(h0);
    expect(headAt(5)).toBe(h1);
  });

  it("holds envelopes in beats and converts 90 ms through tempo", () => {
    expect(envelopeLevel(0, 1, { attackBeats: 0.1, releaseBeats: 0.5 })).toBeCloseTo(0, 9);
    expect(envelopeLevel(0.5, 1, { attackBeats: 0.1, releaseBeats: 0.5 })).toBe(1);
    expect(envelopeLevel(0.9, 1, { attackBeats: 0.1, releaseBeats: 0.5 })).toBeLessThan(1);
    expect(envelopeFromMs(90, 120).attackBeats).toBeCloseTo(0.18, 9);
    expect(envelopeFromMs(90, 60).attackBeats).toBeCloseTo(0.09, 9);
  });

  it("alternates split sides by signedSplit sign", () => {
    const fields = ringFields(30);
    const params = parsePrimitiveParams("SplitAlternate", { rateBeats: 0.5 });

    // Fixed ring indices with known geometry (independent of the classifier):
    // i=0 sits on the left wall (signedSplit < 0), i=15 on the right wall
    // (signedSplit > 0). First half of each rate period one side is up.
    expect(fields.signedSplit[0]!).toBeLessThan(0);
    expect(fields.signedSplit[15]!).toBeGreaterThan(0);
    expect(sampleSpatial("SplitAlternate", params, 0, 0, fields).level).toBe(0);
    expect(sampleSpatial("SplitAlternate", params, 0.5, 0, fields).level).toBe(1);
    expect(sampleSpatial("SplitAlternate", params, 0, 15, fields).level).toBe(1);
    expect(sampleSpatial("SplitAlternate", params, 0.5, 15, fields).level).toBe(0);

    // Both halves exist, so the alternation actually covers the whole ring.
    let negative = 0;

    for (let i = 0; i < fields.count; i++) if (fields.signedSplit[i]! < 0) negative++;
    expect(negative).toBeGreaterThan(0);
    expect(negative).toBeLessThan(fields.count);
  });

  it("renders a geodesic ripple that peaks and decays", () => {
    const fields = ringFields(30);
    const params = parsePrimitiveParams("Ripple", {});
    const levelAt = (beat: number, i: number): number => sampleSpatial("Ripple", params, beat, i, fields).level;
    const headAt = (beat: number): number => {
      let best = 0;
      let bestV = -1;

      for (let i = 0; i < fields.count; i++) {
        const v = levelAt(beat, i);

        if (v > bestV) { bestV = v; best = i; }
      }

      return best;
    };
    const peakAt = (beat: number): number => {
      let peak = 0;

      for (let i = 0; i < fields.count; i++) peak = Math.max(peak, levelAt(beat, i));

      return peak;
    };

    // The front travels: half a beat and two beats put the peak elsewhere.
    expect(headAt(0.5)).not.toBe(headAt(2));
    // And it decays by distance-from-DJ once the front has passed: the
    // point that peaks at beat 0.5 is dark two beats later, and the whole
    // ring's peak is lower than the early peak.
    const imax = headAt(0.5);

    expect(levelAt(0.5, imax)).toBeGreaterThan(0.5);
    expect(levelAt(2.5, imax)).toBeLessThan(levelAt(0.5, imax));
    expect(peakAt(3)).toBeLessThan(peakAt(0.5));
  });

  it("rejects unknown primitive types with a typed error", () => {
    const fields = ringFields(4);
    // The string-level boundary rejects unknown cue types...
    expect(isKnownCueType("nope")).toBe(false);
    // ...and the sampler keeps its own guard for planner data that slipped
    // through: the double cast models the hostile string, not a lie about
    // the value (never would claim it cannot exist).
    const unknownName = "nope" as unknown as PrimitiveName;
    expect(() => sampleSpatial(unknownName, {}, 0, 0, fields)).toThrow(UnknownSpatialError);
  });
});
