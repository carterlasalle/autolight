import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compositeToDeckState, parseFixture, replayFixture, isSupported, unverifiedWarning } from "./index.js";

const base: Record<string, unknown> = {
  rekordboxVersion: "7.2.19",
  platform: "macos",
  action: "play",
  capture: "",
  expectedEvents: [{
    source: "rekordbox", deckId: 1, track: null, playing: true,
    playheadSeconds: 12.5, playRate: 1, effectiveBpm: 128,
    loop: { active: false, startSeconds: null, endSeconds: null, beatLength: null },
    channelFader: 1, crossfader: null, master: true,
  }],
};

describe("rekordbox-live", () => {
  it("replays fixture events on a virtual clock", () => {
    const f = parseFixture(base);
    const at1x = replayFixture(f, 1);
    const at10x = replayFixture(f, 10);
    expect(at1x).toHaveLength(1);
    expect(at1x[0]!.playheadSeconds).toBe(12.5);
    expect(at10x[0]!.receivedAtNs).toBe(at1x[0]!.receivedAtNs);
  });
  it("rejects fixtures with bad faders", () => {
    const bad = structuredClone(base);
    (bad.expectedEvents as Record<string, unknown>[])[0]!["channelFader"] = 9;
    expect(() => parseFixture(bad)).toThrow();
  });
  it("gates support by version and platform", () => {
    const def = { versionRange: "7.2.x", platform: "macos", supported: true } as const;
    expect(isSupported(def, "7.2.19", "macos")).toBe(true);
    expect(isSupported(def, "7.2.19", "windows")).toBe(false);
    expect(isSupported(def, "7.3.0", "macos")).toBe(false);
    expect(unverifiedWarning("7.3.0")).toContain("UNVERIFIED");
  });
  it("replays live 7.2.10 captures (§9.4, §128)", () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "protocol-fixtures", "rekordbox", "7.2.10", "macos");
    for (const action of readdirSync(dir)) {
      const f = parseFixture(JSON.parse(readFileSync(join(dir, action, "capture.json"), "utf8")));
      const states = replayFixture(f, 1);
      expect(states.length).toBeGreaterThan(0);
      for (const s of states) expect(s.source).toBe("rekordbox");
    }
    const both = parseFixture(JSON.parse(readFileSync(join(dir, "both-decks-loaded", "capture.json"), "utf8")));
    expect(replayFixture(both, 10)).toHaveLength(2);
  });
  it("decodes composite snapshots to DeckState (§10, live 7.2.10 tracks)", () => {
    const { state, raw } = compositeToDeckState({
      deckId: 2, row: { rekordboxId: "231828222", title: "Homecoming (feat. Chris Martin)", artist: "Kanye West" },
      playing: false, playheadSeconds: 0, playRate: 1, effectiveBpm: 173.98,
      channelFader: null, crossfader: null, receivedAtNs: 1n,
    });
    expect(state.source).toBe("rekordbox");
    expect(state.track?.id).toBe("rb:231828222");
    expect(state.effectiveBpm).toBe(173.98);
    expect(raw).toMatchObject({ provider: "composite-flx4" });
  });
});
