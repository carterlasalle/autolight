import { describe, expect, it } from "vitest";
import { gateFrame, makeFixture } from "./index.js";

describe("simulator", () => {
  it("makes evenly spaced cells", () => {
    expect(makeFixture("f", 3).cells.map((c) => c.position.x)).toEqual([0, 0.5, 1]);
  });
  it("gates drops and disconnect windows", () => {
    expect(gateFrame(4, { dropEvery: 2 })).toBe("drop");
    expect(gateFrame(5, { dropEvery: 2 })).toBe("send");
    expect(gateFrame(6, { disconnectAt: 5, reconnectAt: 10 })).toBe("offline");
    expect(gateFrame(11, { disconnectAt: 5, reconnectAt: 10 })).toBe("send");
  });
});
