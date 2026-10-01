import { describe, expect, it } from "vitest";
import { blinderIntent, dropIntent, energyIntent, flashIntent, palettePickIntent, sensitivityIntent, trackPalette } from "./manual-intents.js";
import { channels } from "@autolight/ipc";
import type { TrackModel } from "@autolight/contracts";

describe("manual lane intents (T-UI-04)", () => {
  it("names only implemented typed channels", () => {
    for (const intent of [energyIntent("HIGH"), dropIntent(), palettePickIntent([255, 0, 0], false), sensitivityIntent(1.5)]) {
      expect(intent.channel in channels).toBe(true);
    }
  });
  it("carries restraint-aware blinder and custom-flagged palette picks", () => {
    expect(blinderIntent(64).payload).toMatchObject({ at: 64 });
    expect(palettePickIntent([1, 2, 3], true).payload).toMatchObject({ custom: true });
    expect(flashIntent(true).channel).toBe("master/resume");
  });
  it("clamps sensitivity and derives the palette from the track", () => {
    expect(sensitivityIntent(9).payload).toMatchObject({ value: 2 });
    const track = { sections: [{ kind: "chorus" }, { kind: "verse" }] } as unknown as TrackModel;
    expect(trackPalette(track)).toHaveLength(2);
    expect(trackPalette(null)).toEqual([]);
  });
});
