// T-PLAN-05: restraint engine (spec 34/78, P-34, P-78).
import { describe, expect, it } from "vitest";
import type { TrackModel } from "@autolight/contracts";
import { compileShow } from "./compile.js";
import { DEFAULT_CONFIG } from "./config.js";
import { BUILT_IN_STYLES } from "./styles.js";
import { freshRestraint, requestBlinder, restrain } from "./restraint.js";
import { DEFAULT_VENUE_CLASS } from "./types.js";

const style = BUILT_IN_STYLES["club"]!;

function track(whiteHits: number[]): TrackModel {
  return {
    schemaVersion: 1,
    analyzerVersion: "t",
    identity: { id: "restraint", sourceIds: {} },
    durationSeconds: 400,
    beatGrid: { version: 1, beats: [{ index: 0, beatInBar: 1, sourceTimeMs: 0, bpm: 128 }] },
    sections: [{ kind: "chorus", startBeat: 0, endBeat: 256, confidence: 0.9 }],
    musicalEvents: whiteHits.map((beat) => ({ type: "drop", beat, confidence: 0.95 })),
    analysisCoverage: "full",
  } as TrackModel;
}

describe("T-PLAN-05 restraint (P-34, P-78)", () => {
  it("substitutes a full-colour impact for a white hit four beats after the last one", () => {
    const s = freshRestraint();
    const first = restrain(s, "white-hit", 64, 0.25, style, DEFAULT_CONFIG, { impact: true });
    expect(first.verdict.decision).toBe("accept");
    const second = restrain(s, "white-hit", 68, 0.25, style, DEFAULT_CONFIG, { impact: true });
    expect(second.verdict.decision).toBe("substitute");
    if (second.verdict.decision === "substitute") {
      expect(second.verdict.substitute).toBe("impact");
      expect(second.verdict.reason).toContain("beats after the last one");
    }
  });

  it("keeps blinder requests inside the budget and on phrase boundaries", () => {
    const s = freshRestraint();
    expect(requestBlinder(s, 32, 1, true, DEFAULT_CONFIG).decision).toBe("accept");
    // Same phrase region again: inside the white-hit gap, rejected.
    expect(requestBlinder(s, 34, 1, true, DEFAULT_CONFIG).decision).toBe("reject");
    // Off a phrase boundary: rejected even with budget left.
    expect(requestBlinder(freshRestraint(), 33, 1, false, DEFAULT_CONFIG).decision).toBe("reject");
  });

  it("never places two white hits closer than the configured gap without a recorded justification", () => {
    // Property over generated drop spacings: every close pair substitutes.
    for (const gap of [1, 2, 4, 8, 15]) {
      const s = freshRestraint();
      const a = restrain(s, "white-hit", 100, 0.25, style, DEFAULT_CONFIG, { impact: true });
      expect(a.verdict.decision).toBe("accept");
      const b = restrain(s, "white-hit", 100 + gap, 0.25, style, DEFAULT_CONFIG, { impact: true });
      expect(b.verdict.decision).toBe("substitute");
      if (b.verdict.decision === "substitute") expect(b.verdict.reason.length).toBeGreaterThan(0);
    }
    const s = freshRestraint();
    restrain(s, "white-hit", 100, 0.25, style, DEFAULT_CONFIG, { impact: true });
    const far = restrain(s, "white-hit", 100 + DEFAULT_CONFIG.whiteHitMinBeats, 0.25, style, DEFAULT_CONFIG, {
      impact: true,
    });
    expect(far.verdict.decision).toBe("accept");
  });

  it("records every substitution and rejection in the compile result", () => {
    const { plan } = compileShow({
      track: track([64, 66, 68, 200]),
      venue: DEFAULT_VENUE_CLASS,
      style: BUILT_IN_STYLES["festival"]!,
      config: DEFAULT_CONFIG,
    });
    const whites = plan.cues.filter((c) => c.type === "white-hit");
    const starts = whites.map((c) => c.startBeat).sort((a, b) => a - b);
    const gaps = starts.slice(1).map((b, i) => b - starts[i]!);
    for (const g of gaps) expect(g).toBeGreaterThanOrEqual(DEFAULT_CONFIG.whiteHitMinBeats);
    // Diagnostics name the restraint: substituted cues carry the reason.
    const substituted = plan.cues.filter((c) => c.reason.includes("after the last one") || c.reason.includes("budget"));
    expect(substituted.length).toBeGreaterThan(0);
  });

  it("generates strobes on an EDM track within the duty budget", () => {
    const { plan } = compileShow({
      track: track([64, 160]),
      venue: DEFAULT_VENUE_CLASS,
      style: BUILT_IN_STYLES["festival"]!,
      config: { ...DEFAULT_CONFIG, strobeMaxDuty: 0.5 },
    });
    const strobes = plan.cues.filter((c) => c.type === "strobe-burst");
    expect(strobes.length).toBeGreaterThan(0);
    const duty = strobes.reduce((n, c) => n + c.durationBeats, 0) / 256;
    expect(duty).toBeLessThanOrEqual(0.5 + 0.02);
  });
});
