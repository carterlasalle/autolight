import { describe, expect, it } from "vitest";
import { SimulatorShow } from "./simulator-show.js";

// T-QA-02: the Simulator-mode show loop behind the TEST-BUILD TestChannel.
// Real TrackModel fixture → real planner → real renderer → razer bytes over
// loopback UDP into a GoveeLanSim. No mocks of the path itself.

describe("simulator show loop (TestChannel backing)", () => {
  it("loads the fixture track and compiles a plan inside the budget", () => {
    const show = new SimulatorShow();
    const plan = show.loadTrack();
    expect(plan.cues).toBeGreaterThan(0);
    expect(plan.installMs).toBeLessThanOrEqual(plan.budgetMs);
    expect(show.trackId()).toBe("live-deck1");
    expect(show.readiness()).toBe("structured");
  });

  it("reports deck 1 loaded before the tick starts", () => {
    const show = new SimulatorShow();
    show.loadTrack();
    const one = show.decks().find((d) => d.deckId === 1);
    expect(one?.loaded).toBe(true);
    expect(show.fixtureInfo().find((f) => f.sku === "H6076")?.segmentCount).toBe(14);
  });

  it("streams varied razer frames with one arm and zero turns", async () => {
    const show = new SimulatorShow();
    await show.start();
    try {
      await new Promise((r) => setTimeout(r, 300));
      const frames = show.frames();
      expect(frames.length).toBeGreaterThan(0);
      const varied = frames.some(
        (f) => new Set(f.cells.map(([r, g, b]) => `${r},${g},${b}`)).size > 1,
      );
      expect(varied).toBe(true);
      const kinds = new Set((show as unknown as { recording: { records: { kind: string }[] } }).recording.records.map((r) => r.kind));
      expect(kinds.has("razer")).toBe(true);
      const commands = show.commands();
      expect(commands.filter((c) => c.cmd === "turn").length).toBe(0);
      expect(show.armed()).toBe(true);
    } finally {
      await show.shutdown();
    }
  }, 15000);

  it("snapshot equals a transported frame", async () => {
    const show = new SimulatorShow();
    await show.start();
    try {
      await new Promise((r) => setTimeout(r, 300));
      const snapshot = show.snapshot();
      const frames = show.frames();
      const match = frames.find(
        (f) =>
          f.cells.length === snapshot.cells.length &&
          f.cells.every(
            (c, i) =>
              c[0] === snapshot.cells[i]?.[0] &&
              c[1] === snapshot.cells[i]?.[1] &&
              c[2] === snapshot.cells[i]?.[2],
          ),
      );
      expect(match).toBeDefined();
    } finally {
      await show.shutdown();
    }
  }, 15000);

  it("B blacks out to zeros and A resumes on the bar", async () => {
    const show = new SimulatorShow();
    await show.start();
    try {
      await new Promise((r) => setTimeout(r, 200));
      show.key("b");
      await new Promise((r) => setTimeout(r, 150));
      const frames = show.frames();
      const last = frames[frames.length - 1];
      expect(last?.cells.every(([r, g, b]) => r === 0 && g === 0 && b === 0)).toBe(true);
      show.key("a");
      expect(show.resumeStatus().resumedAt).toBe("bar");
    } finally {
      await show.shutdown();
    }
  }, 15000);
});
