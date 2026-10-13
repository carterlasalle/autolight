import { describe, expect, it } from "vitest";
import type { Fixture } from "@autolight/contracts";
import {
  applyOrientation,
  globalCellOrder,
  normalizeOutline,
  perimeterLength,
  polygonArea,
  rectangleRoom,
  selectResolution,
  validateRoom,
} from "./index.js";
import { fromMeters, toMeters, wallLengths } from "./room.js";

// T-QA-12 room field properties (WP05).
// A unit round trip that loses length, an area that goes negative, or a
// bowtie outline that validates clean fails below.

const mk = (id: string, xs: number[]): Fixture => ({
  id, adapter: "govee", sku: "H6076", hardwareId: id,
  cells: xs.map((x, i) => ({ index: i, position: { x, y: 0 }, order: i, tags: [] })),
  calibration: null, groups: [],
});

describe("room field properties", () => {
  it("round-trips units without loss", () => {
    for (const v of [0, 0.5, 1, 3.2, 10, 100]) {
      expect(fromMeters(toMeters(v, "ft"), "ft")).toBeCloseTo(v, 9);
      expect(fromMeters(toMeters(v, "m"), "m")).toBe(v);
    }

    expect(toMeters(1, "ft")).toBeCloseTo(0.3048, 9);
  });

  it("measures the square room exactly and keeps walls consistent", () => {
    const room = rectangleRoom(4, 6);
    expect(polygonArea(room.outline)).toBeCloseTo(24, 9);
    expect(validateRoom(room)).toEqual([]);
    const walls = wallLengths(room.outline);
    expect(walls).toHaveLength(4);
    expect(walls.reduce((a, b) => a + b, 0)).toBeCloseTo(2 * (4 + 6), 9);
    expect(perimeterLength(room.outline)).toBeCloseTo(2 * (4 + 6), 9);
    const again = normalizeOutline(normalizeOutline(room.outline));
    expect(again).toEqual(normalizeOutline(room.outline));
  });

  it("rejects bowties, short outlines, empty ids, and bad openings", () => {
    const bowtie = rectangleRoom(4, 4);
    bowtie.id = "b";
    bowtie.outline = [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 0 }];
    expect(validateRoom(bowtie)).toContain("outline self-intersects: edge 0 crosses edge 2");
    const degenerate = rectangleRoom(4, 4);
    degenerate.id = "d";
    degenerate.outline = [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }];
    expect(validateRoom(degenerate).length).toBeGreaterThan(0);
    const short = rectangleRoom(2, 2);
    short.outline = [{ x: 0, y: 0 }, { x: 1, y: 0 }];
    expect(validateRoom(short).length).toBeGreaterThan(0);
    const noId = rectangleRoom(2, 2);
    noId.id = "";
    expect(validateRoom(noId)).toContain("room.id is required");
    const badWall = rectangleRoom(2, 2);
    badWall.openings = [{ wall: 9, from: 0, to: 0.5, kind: "door" }];
    expect(validateRoom(badWall)).toContain("opening wall 9 out of range");
    const badRange = rectangleRoom(2, 2);
    badRange.openings = [{ wall: 0, from: 0.7, to: 0.3, kind: "window" }];
    expect(validateRoom(badRange)).toContain("opening from/to must satisfy 0 <= from < to <= 1");
  });

  it("orders cells by x, reverses orientation, and picks resolution", () => {
    const order = globalCellOrder([mk("b", [0.9, 0.8]), mk("a", [0.1])]);
    expect(order).toEqual([
      { fixtureId: "a", cellIndex: 0 },
      { fixtureId: "b", cellIndex: 1 },
      { fixtureId: "b", cellIndex: 0 },
    ]);
    const cells = [{ fixtureId: "f", cellIndex: 0 }, { fixtureId: "f", cellIndex: 1 }];
    expect(applyOrientation(cells, "reverse").map((c) => c.cellIndex)).toEqual([1, 0]);
    expect(applyOrientation(applyOrientation(cells, "reverse"), "reverse")).toEqual(cells);
    expect(applyOrientation(cells, "forward")).toEqual(cells);
    expect(selectResolution([{ zones: 200, stableFps: 10 }, { zones: 40, stableFps: 30 }, { zones: 80, stableFps: 25 }], 24)).toBe(80);
    expect(selectResolution([{ zones: 200, stableFps: 10 }], 60)).toBeNull();
  });
});
