import { readdirSync } from "node:fs";
import { basename } from "node:path";
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
      // Fresh isolated profile: the harness mints a new autolight-e2e- temp
      // dir holding only its screenshots folder, no app state or databases.
      expect(basename(harness.userDataDir).startsWith("autolight-e2e-")).toBe(true);
      expect(readdirSync(harness.userDataDir).sort()).toEqual(["screenshots"]);
      // A loaded window reports a non-empty title; a blank/never-loaded
      // window reports "".
      const title = await harness.window.title();
      expect(title.length).toBeGreaterThan(0);
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
      // One arm for the session, at the 25 Hz render tick: a silent drip or
      // a racing transport fails the rate band while still varying colours.
      const first = frames[0]?.sentAtMs ?? 0;
      const last = frames[frames.length - 1]?.sentAtMs ?? 0;
      const spanMs = last - first;
      expect(spanMs).toBeGreaterThan(0);
      const rateHz = (frames.length / spanMs) * 1000;
      console.log(`m1-step7: ${frames.length} frames over ${spanMs} ms (${rateHz.toFixed(1)} Hz), zero turn commands`);
      expect(rateHz).toBeGreaterThan(5);
      await harness.screenshot("m1-step7-show");
    });

    // 8. The show host snapshot the UI renders equals the transported logical
    // frame (P-92-snapshot-equals-output, owned by T-ARC-04).
    await test.step("step 8: UI snapshot equals the transported logical frame", async () => {
      const snapshot = (await harness.invokeTestChannel("snapshot")) as {
        cells: Array<[number, number, number]>;
      };

      const frames = await harness.readFrames();
      expect(snapshot.cells.length).toBeGreaterThan(0);
      // The snapshot reads back the last transported frame (simulator-show),
      // so it must equal the latest frame, not any stale earlier one.
      const latest = frames[frames.length - 1];
      expect(latest).toBeDefined();
      expect(latest?.cells.length).toBe(snapshot.cells.length);
      expect(latest?.cells).toEqual(snapshot.cells);
    });

    // 9. Press B: black frames within 100 ms, stream still armed; press A:
    // resume on the next bar.
    await test.step("step 9: B blacks out within 100 ms, A resumes on the next bar", async () => {
      const t0 = await harness.pressWithTimestamp("b");
      // Both stamps share the Date.now() wall clock (harness wallMs and the
      // recorder's sentAtMs), and the blackout tick may lag the keypress:
      // poll until the zero frame lands.
      let zero: { sentAtMs: number } | null = null;
      const deadline = Date.now() + 5000;

      while (zero === null && Date.now() < deadline) {
        zero = harness.firstZeroFrameAfter(await harness.readFrames(), t0.wallMs);

        if (zero === null) await new Promise((r) => setTimeout(r, 25));
      }

      expect(zero).not.toBeNull();
      expect((zero?.sentAtMs ?? 0) - t0.wallMs).toBeLessThan(100);
      await harness.pressWithTimestamp("a");
      const status = (await harness.invokeTestChannel("resume-status")) as { resumedAt: string };
      expect(status.resumedAt).toBe("bar");
      // Resume paints light again: the latest frame after A is non-black.
      let lit = false;
      const resumeDeadline = Date.now() + 5000;

      while (!lit && Date.now() < resumeDeadline) {
        const frames = await harness.readFrames();
        const last = frames[frames.length - 1];
        lit = last !== undefined && last.cells.some(([r, g, b]) => r !== 0 || g !== 0 || b !== 0);

        if (!lit) await new Promise((r) => setTimeout(r, 25));
      }

      expect(lit).toBe(true);
    });

    // 10. Pause the renderer for 5 s: frames keep flowing (P-56).
    await test.step("step 10: frames keep flowing while the renderer is paused", async () => {
      const before = await harness.readFrames();
      const lastBefore = before[before.length - 1]?.sentAtMs ?? 0;
      await harness.invokeTestChannel("freeze-renderer", { ms: 5000 });
      const after = await harness.readFrames();
      const during = after.filter((f) => f.sentAtMs > lastBefore);
      // Coverage across the whole freeze window: frames must span from near
      // its start to near its end with no stall at either edge, and roughly
      // the 25 Hz tick's frame count.
      expect(during.length).toBeGreaterThanOrEqual(50);
      const freezeMs = 5000;
      expect((during[0]?.sentAtMs ?? 0) - lastBefore).toBeLessThan(500);
      expect((during[during.length - 1]?.sentAtMs ?? 0) - lastBefore).toBeGreaterThanOrEqual(freezeMs - 500);
      let prev = lastBefore;

      for (const f of during) {
        const gap = f.sentAtMs - prev;
        expect(gap).toBeGreaterThanOrEqual(0);
        expect(gap).toBeLessThan(500);
        prev = f.sentAtMs;
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
