import { describe, expect, it } from "vitest";
import { applyLogicalOrder, fitRunMapping, topologyForRuns } from "./placement.js";
import { computeFields, computeFields as compute, fieldCellsFromMap, zeroSFor } from "./fields.js";
import { fieldCellsForReference, referenceById, squareMirrored } from "./index.js";
import { splitWeights } from "./groups.js";
import { setLogicalZero, emptyVenue } from "./venue.js";
import { rectangleRoom } from "./room.js";

function squareSetup(seamS: number, zeroMode: string, logicalZeroS: number) {
  const ref = referenceById("square-loop");
  const room = { ...ref.room, logicalZeroS, perimeterDirection: "clockwise" as const };
  const runs = ref.runs.map((r) => ({ ...r, controllerS: seamS }));

  const zeroS = zeroMode === "dj-nearest" || zeroMode === "front-center"
    ? zeroSFor(room, room.outline, zeroMode)
    : logicalZeroS;

  const built = fieldCellsForReference(ref);
  const mapped = built.cells.map((_, i) => ({ physicalIndex: i, logicalIndex: i, positions: [] as never[] }));
  const order = applyLogicalOrder(mapped, built.midS, zeroS, "clockwise");
  const cells = built.cells.map((c, i) => ({ ...c, logicalIndex: order[i]!.logicalIndex }));
  const fields = compute(room, cells, runs, { zeroS });

  return { ref, room, fields, cells, zeroS };
}

function orbitLevel(s: number, beat: number, beatsPerRevolution: number, tailCells: number, count: number): number {
  const head = (((beat / beatsPerRevolution) % 1) + 1) % 1;
  const d = Math.abs(s - head) % 1;
  const dist = Math.min(d, 1 - d);
  const tail = tailCells / Math.max(1, count);

  return Math.exp(-((dist / Math.max(1e-3, tail)) ** 2) * 2);
}

function splitLevel(signedSplit: number, beat: number, rateBeats: number): number {
  const half = Math.floor(beat / rateBeats) % 2;
  const side = signedSplit >= 0 ? 0 : 1;

  return half === side ? 1 : 0;
}

function rippleLevel(g: number, beat: number, roomFractionPerBeat: number, width: number): number {
  const travelled = beat * roomFractionPerBeat * 2;

  return Math.exp(-(((Math.abs(g * 0.5 - travelled * 0.5) / Math.max(1e-3, width)) ** 2) * 2));
}

describe("P-ROOM probes on SIM", () => {
  it("P-ROOM-01 seam is not the DJ: orbit head at beat 1 sits nearest the DJ projection", () => {
    const { fields } = squareSetup(0.375, "dj-nearest", zeroSFor(rectangleRoom(5, 5), rectangleRoom(5, 5).outline, "dj-nearest"));
    let best = 0;
    let bestV = -1;

    for (let i = 0; i < fields.count; i++) {
      const v = orbitLevel(fields.s[i]!, 1, 4, 3, fields.count);

      if (v > bestV) { bestV = v; best = i; }
    }

    expect(fields.physical[best]).not.toBe(0);
    expect(fields.gDj[best]!).toBeLessThan(0.6);
    expect(fields.dDj[best]!).toBeLessThan(0.5);
  });

  it("P-ROOM-02 orbit crosses the seam without a dark frame", () => {
    const { fields } = squareSetup(0.375, "dj-nearest", 0);
    let worstJump = 0;
    let prev = -1;

    for (let tick = 0; tick < 16; tick++) {
      const beat = tick * 0.25;
      let best = 0;
      let bestV = -1;

      for (let i = 0; i < fields.count; i++) {
        const v = orbitLevel(fields.s[i]!, beat, 4, 3, fields.count);

        if (v > bestV) { bestV = v; best = i; }
      }

      // Peak cell stays lit every tick: no dark frame at the seam crossing.
      expect(bestV).toBeGreaterThan(0.5);

      if (prev >= 0) {
        const jump = Math.min(Math.abs(best - prev), fields.count - Math.abs(best - prev));
        worstJump = Math.max(worstJump, jump);
      }

      prev = best;
    }

    expect(worstJump).toBeLessThanOrEqual(3);
  });

  it("P-ROOM-03 half-room strobe alternates sides with DS-33 feather", () => {
    const { fields } = squareSetup(0, "dj-nearest", 0);
    // Production side assignment plus feather: cells on the split line carry
    // intermediate weights, so a hard switch cannot pass.
    const w = splitWeights(fields, { id: "halves", kind: "halves" }, { featherM: 10 });
    const leftIdx: number[] = [];
    const rightIdx: number[] = [];

    for (let i = 0; i < fields.count; i++) {
      if (fields.signedSplit[i]! >= 0) leftIdx.push(i);
      else rightIdx.push(i);

      expect(w[0]![i]! + w[1]![i]!).toBeCloseTo(1, 6);
    }

    expect(leftIdx.length).toBeGreaterThan(0);
    expect(rightIdx.length).toBeGreaterThan(0);
    expect(leftIdx.every((i) => w[0]![i]! > w[1]![i]!)).toBe(true);
    expect(rightIdx.every((i) => w[1]![i]! > w[0]![i]!)).toBe(true);

    for (const i of leftIdx) {
      expect(splitLevel(fields.signedSplit[i]!, 0, 0.5)).toBe(1);
      expect(splitLevel(fields.signedSplit[i]!, 0.5, 0.5)).toBe(0);
    }

    for (const i of rightIdx) {
      expect(splitLevel(fields.signedSplit[i]!, 0, 0.5)).toBe(0);
      expect(splitLevel(fields.signedSplit[i]!, 0.5, 0.5)).toBe(1);
    }
  });

  it("P-ROOM-04 two-way pulse meets at the antipode on beat 4", () => {
    const { fields } = squareSetup(0, "dj-nearest", 0);
    // Antipode from production fields: gDj peaks opposite the DJ projection.
    let far = 0;

    for (let i = 1; i < fields.count; i++) {
      if (fields.gDj[i]! > fields.gDj[far]!) far = i;
    }

    expect(fields.gDj[far]!).toBeGreaterThan(0.5);
    let bestBeat = 0;
    let bestFar = -1;

    for (let b = 0; b <= 20; b++) {
      const beat = b * 0.25;
      const level = rippleLevel(fields.gDj[far]!, beat, 0.125, 0.2);

      if (level > bestFar) { bestFar = level; bestBeat = beat; }
    }

    expect(bestFar).toBeGreaterThan(0.3);
    expect(Math.abs(bestBeat - 4)).toBeLessThanOrEqual(1.5);
  });

  it("P-ROOM-05 mirrored strip is classified split-mirrored and cannot orbit", () => {
    const ref = squareMirrored();
    expect(topologyForRuns(ref.runs)).toBe("split-mirrored");
    expect(topologyForRuns(referenceById("square-loop").runs)).toBe("closed-loop");
  });

  it("P-ROOM-06 logical zero persists and remap keeps logical goldens", () => {
    const venue = setLogicalZero(emptyVenue(rectangleRoom(5, 5)), 0.4);
    expect(venue.logicalZeroS).toBeCloseTo(0.4, 9);
    const ref = referenceById("square-loop");

    const before = computeFields(
      { ...ref.room, logicalZeroS: 0.4 },
      fieldCellsForReference(ref).cells,
      ref.runs,
      { zeroS: 0.4 },
    );

    const remapped = computeFields(
      { ...ref.room, logicalZeroS: 0.4 },
      fieldCellsFromMap("strip", { cells: fitRunMapping(ref.runs[0]!, 30, []) }, ref.runs, 2.5),
      ref.runs,
      { zeroS: 0.4 },
    );

    expect(before.count).toBe(remapped.count);
    const sig = (arr: Float32Array): string => [...arr].map((v) => Math.round(v * 255).toString(16)).join(",");
    expect(sig(before.s)).toBe(sig(remapped.s));
  });

  it("P-ROOM-07 gaps are recorded on the chunked reference room", () => {
    const ref = referenceById("square-chunks");
    expect(ref.gaps.length).toBe(2);
    const room = { ...ref.room, logicalZeroS: 0, perimeterDirection: "clockwise" as const };
    const built = fieldCellsForReference(ref);
    const fields = computeFields(room, built.cells, ref.runs, { zeroS: 0 });
    let peak = 0;

    for (let i = 0; i < fields.count; i++) peak = Math.max(peak, orbitLevel(fields.s[i]!, 1, 4, 3, fields.count));
    expect(peak).toBeGreaterThan(0.5);
  });
});
