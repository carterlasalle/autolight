import { describe, expect, it } from "vitest";
import { gateFrame, makeFixture, soak } from "./index.js";

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
  it("soaks 4h-equivalent frames with no queue growth", () => {
    // 4h @ 60Hz logical = 864k frames; newest-state-wins drains every tick.
    const r = soak(864_000, (i) => gateFrame(i, { dropEvery: 97, disconnectAt: 1000, reconnectAt: 2000 }));
    expect(r.maxPending).toBeLessThanOrEqual(1);
    expect(r.sent + r.dropped + r.offline).toBe(864_000);
    expect(r.offline).toBe(1000);
  });
});
