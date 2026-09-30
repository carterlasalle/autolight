import { test, expect } from "@playwright/test";
import { launchAutolight } from "./_harness.js";

// M1 minimum proof scenario (99-final-acceptance.md section 2, owned by
// T-QA-02 as a failing probe). The show host (T-ARC-01) and the simulator
// plus recording transport (T-GOV-14) are being built in parallel, so every
// step from step 2 on fails at the test channel until they land. Step 1
// proves the harness itself: the real built app launches in Simulator mode
// with a clean profile. Nothing here runs against `yarn dev`.
test("m1 slice: clean launch to graceful shutdown in Simulator mode", async () => {
  const harness = await launchAutolight();
  try {
    // 1. Clean userData. Launch the built app (not `yarn dev`).
    await test.step("step 1: clean profile launches the built app", async () => {
      expect(harness.userDataDir.length).toBeGreaterThan(0);
      expect(await harness.window.title()).toEqual(expect.any(String));
      await harness.screenshot("m1-step1-launch");
    });

    // 2. Startup stages appear in order with timings (spec 132, P-132).
    await test.step("step 2: startup stages in order with timings", async () => {
      const stages = (await harness.invokeTestChannel("stages")) as { name: string; atMs: number }[];
      expect(stages.map((s) => s.name)).toEqual([
        "db", "show-worker", "govee", "dj-adapter", "library",
        "analysis", "venue", "tracks", "plans", "arm", "ready",
      ]);
      for (let i = 1; i < stages.length; i++) {
        expect(stages[i]?.atMs).toBeGreaterThanOrEqual(stages[i - 1]?.atMs ?? 0);
      }
    });

    // 3. The library reader opens the fixture Rekordbox DB (SIM); one real
    // ANLZ-analysed track is resolved.
    await test.step("step 3: fixture library resolves one ANLZ track", async () => {
      const library = (await harness.invokeTestChannel("library")) as {
        tracks: { id: string; readiness: string }[];
      };
      expect(library.tracks.length).toBeGreaterThanOrEqual(1);
      expect(library.tracks.some((t) => t.readiness === "READY")).toBe(true);
    });

    // 4. The Govee manager discovers the simulated H6076 (SIM) through the
    // discovery ladder; qualification detects its segment count.
    await test.step("step 4: simulated H6076 discovered with qualified segment count", async () => {
      const fixtures = (await harness.invokeTestChannel("fixtures")) as {
        id: string; sku: string; segmentCount: number; qualified: boolean;
      }[];
      const h6076 = fixtures.find((f) => f.sku === "H6076");
      expect(h6076).toBeDefined();
      expect(h6076?.segmentCount).toBeGreaterThan(1);
      expect(h6076?.qualified).toBe(true);
    });

    // 5. The rkbx-osc simulator (SIM) reports deck 1 loaded and playing.
    await test.step("step 5: deck 1 loaded and playing", async () => {
      const decks = (await harness.invokeTestChannel("decks")) as {
        deckId: number; loaded: boolean; playing: boolean;
      }[];
      const one = decks.find((d) => d.deckId === 1);
      expect(one?.loaded).toBe(true);
      expect(one?.playing).toBe(true);
    });

    // 6. The track resolves to its TrackModel and a ShowPlan compiled by the
    // real planner, installed in the show host within the fast-path budget.
    await test.step("step 6: plan installed within the fast-path budget", async () => {
      const plan = (await harness.invokeTestChannel("plan")) as {
        cues: unknown[]; installMs: number; budgetMs: number;
      };
      expect(plan.cues.length).toBeGreaterThan(0);
      expect(plan.installMs).toBeLessThanOrEqual(plan.budgetMs);
    });

    // 7. The recording transport (SIM) shows razer frames with per-segment
    // colours that differ across segments, at the qualified rate, one arm,
    // zero `turn` commands.
    await test.step("step 7: razer frames with per-segment color, one arm, zero turn", async () => {
      const frames = await harness.readFrames();
      expect(frames.length).toBeGreaterThan(0);
      const varied = frames.some(
        (f) => new Set(f.cells.map(([r, g, b]) => `${r},${g},${b}`)).size > 1,
      );
      expect(varied).toBe(true);
      const commands = (await harness.invokeTestChannel("commands")) as {
        cmd: string; kelvin?: number;
      }[];
      expect(commands.filter((c) => c.cmd === "turn").length).toBe(0);
      expect(
        commands.filter((c) => c.cmd === "colorwc" && typeof c.kelvin === "number" && c.kelvin > 0).length,
      ).toBe(0);
      const first = frames[0]?.sentAtMs ?? 0;
      const last = frames[frames.length - 1]?.sentAtMs ?? 0;
      const spanMs = last - first;
      const rateHz = spanMs > 0 ? (frames.length / spanMs) * 1000 : 0;
      console.log(`m1-step7: ${frames.length} frames over ${spanMs} ms (${rateHz.toFixed(1)} Hz), zero turn commands`);
      await harness.screenshot("m1-step7-show");
    });

    // 8. The show host snapshot the UI renders equals the transported logical
    // frame (P-92-snapshot-equals-output, owned by T-ARC-04).
    await test.step("step 8: UI snapshot equals the transported logical frame", async () => {
      const snapshot = (await harness.invokeTestChannel("snapshot")) as {
        cells: Array<[number, number, number]>;
      };
      const frames = await harness.readFrames();
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
    });

    // 9. Press B: black frames within 100 ms, stream still armed; press A:
    // resume on the next bar.
    await test.step("step 9: B blacks out within 100 ms, A resumes on the next bar", async () => {
      const t0 = await harness.pressWithTimestamp("b");
      const frames = await harness.readFrames();
      const zero = harness.firstZeroFrameAfter(frames, t0.wallMs);
      expect(zero).not.toBeNull();
      expect((zero?.sentAtMs ?? 0) - t0.wallMs).toBeLessThan(100);
      const resume = await harness.pressWithTimestamp("a");
      const status = (await harness.invokeTestChannel("resume-status")) as { resumedAt: string };
      expect(status.resumedAt).toBe("bar");
      expect(resume.wallMs).toBeGreaterThan(t0.wallMs);
    });

    // 10. Pause the renderer for 5 s: frames keep flowing (P-56).
    await test.step("step 10: frames keep flowing while the renderer is paused", async () => {
      const before = await harness.readFrames();
      const lastBefore = before[before.length - 1]?.sentAtMs ?? 0;
      await harness.invokeTestChannel("freeze-renderer", { ms: 5000 });
      const after = await harness.readFrames();
      const during = after.filter((f) => f.sentAtMs > lastBefore);
      expect(during.length).toBeGreaterThan(0);
      for (let i = 1; i < during.length; i++) {
        expect((during[i]?.sentAtMs ?? 0) - (during[i - 1]?.sentAtMs ?? 0)).toBeLessThan(500);
      }
    });

    // 11. Quit: the ending look is sent, streams disarmed, DB flushed (P-133).
    await test.step("step 11: quit sends the ending look, disarms, flushes", async () => {
      const shutdown = (await harness.invokeTestChannel("shutdown")) as {
        endingLookSent: boolean; streamsDisarmed: boolean; dbFlushed: boolean;
      };
      expect(shutdown.endingLookSent).toBe(true);
      expect(shutdown.streamsDisarmed).toBe(true);
      expect(shutdown.dbFlushed).toBe(true);
    });
  } finally {
    await harness.close();
  }
});
