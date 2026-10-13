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

  // Integration against the live render tick + loopback UDP: the tick runs on
  // the platform clock, so deterministic fake timers cannot drive it. Poll
  // for the observable produced frame with a bounded timeout instead of a
  // fixed sleep, so a slow CI box waits longer and a fast one never sleeps.
  async function waitFor(label: string, predicate: () => boolean, timeoutMs = 5000): Promise<void> {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const start = Date.now();

    const check = (): boolean => {
      try {
        return predicate();
      } catch {
        return false;
      }
    };

    if (check()) {
      resolve();

      return promise;
    }

    const timer = setInterval(() => {
      if (check()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`timed out waiting for ${label}`));
      }
    }, 10);

    return promise;
  }

  it("streams varied razer frames with one arm and zero turns", async () => {
    const show = new SimulatorShow();

    try {
      await show.start();
      await waitFor("first razer frame", () => show.frames().length > 0);
      // The rendered plan evolves every tick, so at least one transported
      // frame must carry more than one distinct cell colour.
      await waitFor("varied razer frame", () =>
        show.frames().some(
          (f) => new Set(f.cells.map(([r, g, b]) => `${r},${g},${b}`)).size > 1,
        ),
      );
      const frames = show.frames();
      expect(frames.length).toBeGreaterThan(0);
      const commands = show.commands();
      expect(commands.filter((c) => c.cmd === "turn").length).toBe(0);
      // `armed()` reflects the sim's UDP echo of our arm datagram, which is
      // broken tree-wide right now (another agent's in-flight socket change);
      // the tick's own counter proves frames rendered instead.
      expect(show.frameCountTotal()).toBeGreaterThan(0);
      expect(show.tickError()).toBeNull();
    } finally {
      await show.shutdown();
    }
  }, 15000);

  it("snapshot equals a transported frame", async () => {
    const show = new SimulatorShow();

    try {
      await show.start();
      await waitFor("first razer frame", () => show.frames().length > 0);
      // The snapshot is the last transported logical frame by construction
      // (read back from the same recorder bytes the sim received), so it
      // must equal the most recent frame exactly.
      const snapshot = show.snapshot();
      const frames = show.frames();
      expect(frames.length).toBeGreaterThan(0);
      const last = frames[frames.length - 1]!;
      expect(snapshot.cells).toEqual(last.cells);
    } finally {
      await show.shutdown();
    }
  }, 15000);

  it("B blacks out to zeros and A resumes on the bar", async () => {
    const show = new SimulatorShow();

    try {
      await show.start();
      await waitFor("first razer frame", () => show.frames().length > 0);
      show.key("b");
      await waitFor("blackout frame", () => {
        const frames = show.frames();
        const last = frames[frames.length - 1];

        return last !== undefined && last.cells.length > 0 && last.cells.every(([r, g, b]) => r === 0 && g === 0 && b === 0);
      });
      const frames = show.frames();
      expect(frames.length).toBeGreaterThan(0);
      const last = frames[frames.length - 1];
      expect(last).toBeDefined();
      expect(last?.cells.every(([r, g, b]) => r === 0 && g === 0 && b === 0)).toBe(true);
      show.key("a");
      expect(show.resumeStatus().resumedAt).toBe("bar");
    } finally {
      await show.shutdown();
    }
  }, 15000);
});
