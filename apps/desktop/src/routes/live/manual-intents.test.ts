import { describe, expect, it, vi } from "vitest";
import { blinderIntent, buildIntent, dropIntent, energyIntent, freezeHoldIntent, palettePickIntent, sensitivityIntent, trackPalette } from "./manual-intents.js";
import type { ManualIntent } from "./manual-intents.js";
import { channels } from "@autolight/ipc";
import type { TrackModel } from "@autolight/contracts";

function checkIntent(intent: ManualIntent): void {
  expect(Object.prototype.hasOwnProperty.call(channels, intent.channel)).toBe(true);
  // SAFETY: `channel` is an own property of the typed channel table by the
  // assertion above, so indexing by the intent's channel is exact.
  const channel = channels[intent.channel];
  expect(() => channel.request.parse(intent.payload)).not.toThrow();
}

describe("manual lane intents (T-UI-04)", () => {
  it("names only implemented typed channels with schema-valid payloads", () => {
    for (const intent of [energyIntent("HIGH"), dropIntent(), buildIntent(), blinderIntent(), freezeHoldIntent(true), freezeHoldIntent(false), sensitivityIntent(0.7)]) {
      checkIntent(intent);
    }
    // Prototype-chain names must not pass as implemented channels.
    expect(Object.prototype.hasOwnProperty.call(channels, "toString")).toBe(false);
  });
  it("carries exact blinder and clamped palette-pick payloads", () => {
    expect(blinderIntent()).toEqual({ channel: "show/trigger-build", payload: { version: 1 } });
    expect(palettePickIntent([1, 2, 3])).toEqual({ channel: "venue/set-color", payload: { version: 1, rgb: [1, 2, 3] } });
    expect(palettePickIntent([300, -20, 128.6])).toEqual({ channel: "venue/set-color", payload: { version: 1, rgb: [255, 0, 129] } });
    expect(freezeHoldIntent(true)).toEqual({ channel: "master/freeze", payload: { version: 1, frozen: true } });
    expect(freezeHoldIntent(false)).toEqual({ channel: "master/resume", payload: { version: 1, at: "bar" } });
  });
  it("clamps sensitivity into the schema range and guards non-finite input", () => {
    expect(sensitivityIntent(9).payload).toMatchObject({ value: 1 });
    expect(sensitivityIntent(-3).payload).toMatchObject({ value: 0 });
    expect(sensitivityIntent(Number.NaN).payload).toMatchObject({ value: 0 });
    expect(sensitivityIntent(0.5).payload).toMatchObject({ value: 0.5 });
    checkIntent(sensitivityIntent(9));
    checkIntent(sensitivityIntent(Number.NaN));
    // Chorus+verse dedup: two chorus sections collapse to one swatch, and the
    // exact values pin SWATCH_BY_KIND instead of just counting entries.
    // SAFETY: sections carry only `kind` here because trackPalette reads just
    // `sections[].kind`; the narrowed pick keeps the fixture honest.
    const track = {
      sections: [{ kind: "chorus" }, { kind: "chorus" }, { kind: "verse" }],
    } as Pick<TrackModel, "sections"> as TrackModel;
    expect(trackPalette(track)).toEqual([[255, 200, 0], [12, 36, 150]]);
    expect(trackPalette(null)).toEqual([]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // SAFETY: same narrowed-sections fixture shape as above.
    const drifted = { sections: [{ kind: "no-such-kind" as TrackModel["sections"][number]["kind"] }] } as Pick<TrackModel, "sections"> as TrackModel;
    expect(trackPalette(drifted)).toEqual([[255, 255, 255]]);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
