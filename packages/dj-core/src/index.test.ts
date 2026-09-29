import { describe, expect, it } from "vitest";
import { estimatePosition, isSeek, audibleWeight } from "./index.js";
import type { DeckState } from "@autolight/contracts";
const base: DeckState = { source: "rekordbox", deckId: 1, track: null, playing: true, playheadSeconds: 10, playRate: 1, effectiveBpm: 128, loop: { active: false, startSeconds: null, endSeconds: null, beatLength: null }, channelFader: 0.8, crossfader: 0.5, master: true, receivedAtNs: 0n };
describe("dj-core", () => {
  it("extrapolates while playing", () => { expect(estimatePosition(base, 1_000_000_000n)).toBeCloseTo(11); });
  it("holds while paused", () => { expect(estimatePosition({ ...base, playing: false }, 5_000_000_000n)).toBe(10); });
  it("detects seeks", () => { expect(isSeek(10, 30)).toBe(true); expect(isSeek(10, 10.1)).toBe(false); });
  it("weights silence when no track", () => { expect(audibleWeight(base)).toBe(0); });
});
