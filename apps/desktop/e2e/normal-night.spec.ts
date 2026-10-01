import { test, expect } from "@playwright/test";
import { launchAutolight } from "../journeys/_harness.js";

// T-QA-11 normal-night acceptance (99-final-acceptance.md section 3).
// SIM version: the spec 124 rig (two H6076 profiles, one H1A45 perimeter
// strip in the reference square room, one extra simulated fixture) plus a
// Rekordbox source through fusion and a scripted DJ. All 17 rows as
// test.step blocks. Red by design until the show host (T-ARC-01), the
// simulator plus recording transport (T-GOV-14), and the planner/room
// wiring land; each row fails at the test channel until then. The HW
// version is HW-NIGHT-01, run by the owner on the real rig.

const ROWS = [
  "row 1: READY within ops.startup.budgetMs with REKORDBOX badge",
  "row 2: Rekordbox connects automatically",
  "row 3: Govee rig armed without user action",
  "row 4: prepared playlist shows FULL",
  "row 5: track A installed within fast-path budget with sections",
  "row 6: beat error p95 under qa.sync.maxBeatErrorMs",
  "row 7: track B installed, silent while its fader is down",
  "row 8: B fader introduces palette, then rhythm, then impacts (P-67)",
  "row 9: crossfade moves visual ownership toward B",
  "row 10: drop in B owned by B, no leak from A (P-65)",
  "row 11: loop in B repeats with pass variation",
  "row 12: hot cue and seek snap within one tick",
  "row 13: pitch B +-8pct keeps beat error in bound",
  "row 14: one lamp unplugged 10 s, others unaffected, re-armed in budget",
  "row 15: busy UI keeps tick jitter p99 under 5 ms",
  "row 16: orbit, two-way ripple, and half-room split cross the seam",
  "row 17: ending look sent, streams disarmed",
] as const;

test("normal night: 17-row SIM acceptance", async () => {
  const harness = await launchAutolight();
  try {
    await harness.waitForReady();
    for (const row of ROWS) {
      await test.step(row, async () => {
        // Each row reads its state through the test channel; until the
        // channel lands every row fails here, which is the red run.
        const state = (await harness.invokeTestChannel("normal-night-row", { row })) as {
          pass: boolean;
          detail?: string;
        };
        expect(state.pass, state.detail ?? row).toBe(true);
      });
    }
  } finally {
    await harness.close();
  }
});
