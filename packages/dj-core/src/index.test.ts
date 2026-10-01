import { describe, expect, it } from "vitest";
import {
  DEFAULT_ASSIGNMENT,
  PROVIDER_ORDER,
  audibleWeight,
  crossfaderGain,
  deckWeight,
  estimatePosition,
  exceedsSeekThreshold,
  isSeek,
  resolveCrossfader,
  sideOf,
} from "./index.js";
import type { DeckState } from "@autolight/contracts";
const base: DeckState = { source: "rekordbox", deckId: 1, track: null, playing: true, playheadSeconds: 10, playRate: 1, effectiveBpm: 128, loop: { active: false, startSeconds: null, endSeconds: null, beatLength: null }, channelFader: 0.8, crossfader: 0.5, master: true, receivedAtNs: 0n };
const track = { id: "t", sourceIds: {} };
describe("dj-core", () => {
  it("extrapolates while playing", () => { expect(estimatePosition(base, 1_000_000_000n)).toBeCloseTo(11); });
  it("holds while paused", () => { expect(estimatePosition({ ...base, playing: false }, 5_000_000_000n)).toBe(10); });
  it("detects seeks", () => { expect(isSeek(10, 30)).toBe(true); expect(isSeek(10, 10.1)).toBe(false); });
  it("weights silence when no track", () => { expect(audibleWeight(base)).toBe(0); });
  it("prefers lighting provider over composite over adaptive (§7)", () => {
    expect([...PROVIDER_ORDER]).toEqual(["lighting", "composite-flx4", "adaptive"]);
  });
  it("converts the seek threshold through the deck tempo (T-RUN-03)", () => {
    // 0.3 beats at 2 beats/s is 150 ms: inside both thresholds.
    expect(exceedsSeekThreshold(10, 10.3, 2)).toBe(false);
    // 0.6 beats crosses the beat threshold; 0.2 beats at 0.5 beats/s is 400 ms.
    expect(exceedsSeekThreshold(10, 10.6, 2)).toBe(true);
    expect(exceedsSeekThreshold(10, 10.2, 0.5)).toBe(true);
  });
  it("reads the crossfader side from the assignment (§63)", () => {
    expect(sideOf(1, DEFAULT_ASSIGNMENT)).toBe("A");
    expect(sideOf(2, DEFAULT_ASSIGNMENT)).toBe("B");
    expect(sideOf(4, DEFAULT_ASSIGNMENT)).toBe("THRU");
  });
  it("shapes the crossfader gain per curve (§63)", () => {
    expect(crossfaderGain(0, "A", "linear")).toBe(1);
    expect(crossfaderGain(1, "A", "linear")).toBe(0);
    expect(crossfaderGain(0, "B", "linear")).toBe(0);
    expect(crossfaderGain(1, "B", "linear")).toBe(1);
    expect(crossfaderGain(0.5, "A", "constant-power")).toBeCloseTo(Math.SQRT1_2, 6);
    expect(crossfaderGain(0.5, "B", "constant-power")).toBeCloseTo(Math.SQRT1_2, 6);
    expect(crossfaderGain(0.49, "A", "sharp-cut")).toBe(1);
    expect(crossfaderGain(0.5, "B", "sharp-cut")).toBe(1);
    expect(crossfaderGain(0.5, "A", "sharp-cut")).toBe(0);
    // THRU ignores the crossfader entirely.
    expect(crossfaderGain(1, "THRU", "sharp-cut")).toBe(1);
    expect(crossfaderGain(0, "THRU", "linear")).toBe(1);
  });
  it("weights decks by fader, position, assignment and master (§63)", () => {
    const a = { ...base, track, deckId: 1, channelFader: 1 };
    const b = { ...base, track, deckId: 2, channelFader: 1 };
    expect(deckWeight(a, 0)).toBe(1); // hard left: A up, master bonus capped
    expect(deckWeight(b, 0)).toBe(0);
    expect(deckWeight(a, 1)).toBe(0);
    expect(deckWeight(b, 1)).toBe(1);
    expect(deckWeight(a, 0.5)).toBeCloseTo(0.55, 6); // master bonus on top of the curve
    const quiet = { ...b, master: false, channelFader: 0.5 };
    expect(deckWeight(quiet, 1)).toBeCloseTo(0.5, 6);
    const loud = { ...b, master: true, channelFader: 0.5 };
    expect(deckWeight(loud, 1)).toBeCloseTo(0.55, 6);
  });
  it("resolves the DS-26 crossfader source in order (T-MIX-01)", () => {
    expect(resolveCrossfader("auto", { software: 0.2, controller: 0.9 }).source).toBe("software");
    expect(resolveCrossfader("auto", { controller: 0.9 }).source).toBe("controller");
    expect(resolveCrossfader("auto", {}).fellBack).toBe(true);
    expect(resolveCrossfader("controller", { software: 0.2, controller: 0.9 }).position).toBe(0.9);
    expect(resolveCrossfader("configured", { configured: 0.4 }).position).toBe(0.4);
    expect(resolveCrossfader("auto", { software: 0.2, controller: 0.9 }).spread).toBeCloseTo(0.7, 6);
  });
});
