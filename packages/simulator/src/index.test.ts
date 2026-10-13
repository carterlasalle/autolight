import { describe, expect, it } from "vitest";
import { gateFrame, makeFixture, performanceScenario, soak } from "./index.js";

describe("simulator", () => {
  it("makes evenly spaced cells with stable identity", () => {
    const f = makeFixture("f", 3);

    expect(f.cells).toHaveLength(3);
    expect(f.cells.map((c) => c.position.x)).toEqual([0, 0.5, 1]);
    expect(f.cells.every((c) => c.position.y === 0)).toBe(true);
    expect(f.cells.map((c) => c.index)).toEqual([0, 1, 2]);
    expect(f.cells.map((c) => c.order)).toEqual([0, 1, 2]);
    expect(f.hardwareId).toBe("f");
    expect(f.calibration).not.toBeNull();
    expect(f.calibration?.segmentCount).toBe(3);
  });
  it("gates drops and disconnect windows with exact boundaries", () => {
    expect(gateFrame(4, { dropEvery: 2 })).toBe("drop");
    expect(gateFrame(5, { dropEvery: 2 })).toBe("send");
    expect(gateFrame(6, { disconnectAt: 5, reconnectAt: 10 })).toBe("offline");
    expect(gateFrame(11, { disconnectAt: 5, reconnectAt: 10 })).toBe("send");
    // Boundaries are inclusive-open: [disconnectAt, reconnectAt).
    expect(gateFrame(5, { disconnectAt: 5, reconnectAt: 10 })).toBe("offline");
    expect(gateFrame(10, { disconnectAt: 5, reconnectAt: 10 })).toBe("send");
    // An open-ended window stays offline past the disconnect.
    expect(gateFrame(1_000_000, { disconnectAt: 5 })).toBe("offline");
  });
  it("soaks 4h-equivalent frames with exact bucket counts", () => {
    // 4h @ 60Hz logical = 864k frames; newest-state-wins drains every tick.
    const r = soak(864_000, (i) => gateFrame(i, { dropEvery: 97, disconnectAt: 1000, reconnectAt: 2000 }));

    expect(r.sent + r.dropped + r.offline).toBe(864_000);
    expect(r.offline).toBe(1000);
    // Frames 0..863999 with i % 97 === 0 drop, except the 1000 offline
    // frames in [1000, 2000) (10 of which are also multiples of 97).
    expect(r.dropped).toBe(8898);
    expect(r.sent).toBe(864_000 - 8898 - 1000);
  });
  it("rehearses a full performance: hands over decks, loops, never stalls", () => {
    let n = 0;
    const deckSeq: number[] = [];
    let loopEvents = 0;
    let wasLooping = false;

    for (const d of performanceScenario({ fps: 60, hours: 0.05 })) {
      n++;
      deckSeq.push(d.deckId);

      if (d.loop.active && !wasLooping) loopEvents++;
      wasLooping = d.loop.active;
    }

    // fps 60 x 0.05h = exactly 10800 frames; the guard-free loop must run all.
    expect(n).toBe(10800);
    expect(new Set(deckSeq)).toEqual(new Set([1, 2]));
    // Lead deck swaps every 60s wall-clock and at least one loop span runs.
    expect(loopEvents).toBeGreaterThan(0);
    const firstSwap = deckSeq.findIndex((d, i) => i > 0 && d !== deckSeq[i - 1]);
    expect(firstSwap).toBe(3600);
  });
});
