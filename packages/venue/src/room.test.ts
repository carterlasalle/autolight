import { describe, expect, it } from "vitest";
import { polygonArea, normalizeOutline, validateRoom, rectangleRoom, polylineLength, signedArea } from "./room.js";

describe("T-ROOM-01 room and anchor model", () => {
  it("normalizes polygon orientation to clockwise from above", () => {
    const ccw = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 5 }];
    expect(signedArea(ccw)).toBeGreaterThan(0);
    const fixed = normalizeOutline(ccw);
    expect(signedArea(fixed)).toBeLessThan(0);
    expect(polygonArea(fixed)).toBeCloseTo(25, 9);
  });

  it("rejects self-intersecting outlines with a clear message", () => {
    const room = rectangleRoom(5, 5);
    room.outline = [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 5 }, { x: 5, y: 0 }];
    const problems = validateRoom(room);
    expect(problems.some((p) => p.includes("self-intersects"))).toBe(true);
  });

  it("rejects degenerate outlines with non-positive area", () => {
    const room = rectangleRoom(5, 5);
    room.outline = [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }];
    expect(validateRoom(room).some((p) => p.includes("area"))).toBe(true);
  });

  it("keeps centroid separate from the DJ anchor and the seam", () => {
    const room = rectangleRoom(5, 5);
    expect(validateRoom(room)).toEqual([]);
    expect(room.anchors.dj.position).not.toEqual({ x: 0, y: 0 });
    expect(room.logicalZeroS).toBe(0);
  });

  it("measures spline arc length close to the analytic circle", () => {
    const pts = Array.from({ length: 12 }, (_, i) => {
      const a = (i / 12) * Math.PI * 2;
      return { x: Math.cos(a), y: Math.sin(a), z: 2.5 };
    });
    const len = polylineLength(pts, { kind: "catmull-rom" }, 0.001, true);
    expect(Math.abs(len - Math.PI * 2)).toBeLessThan(0.15);
  });
});
