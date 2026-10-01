import { describe, expect, it } from "vitest";
import { buildStatusPacket } from "./prolink.js";
import { ProlinkProvider } from "./prolink-provider.js";
import { encodeOscMessage } from "./osc.js";
import { RkbxOscProvider } from "./rkbx-osc.js";
import { FusionEngine } from "./fusion.js";
import { ScriptedProvider } from "./providers.js";
import { VIRTUAL_TRACK_A, VIRTUAL_TRACK_B } from "./test-tracks.js";

let now = 1_000n * 1_000_000_000n;
const clock = (): bigint => now;

describe("master deck, loop, pitch, SYNC, hotcue and roll (T-LIVE-14)", () => {
  it("clears the prolink loop and beat counter on track replacement", () => {
    const provider = new ProlinkProvider({ now: () => now });
    provider.ingestPacket(buildStatusPacket({
      deviceName: "CDJ-1", deviceNumber: 1, trackId: 111, trackSlot: 1,
      playState: 4, master: true, sync: true, beatInBar: 1,
    }), now);
    expect(provider.getDecks()[0]?.loopRoll?.active).toBe(true);
    provider.ingestPacket(buildStatusPacket({
      deviceName: "CDJ-1", deviceNumber: 1, trackId: 222, trackSlot: 1,
      playState: 3, master: true, sync: false, beatInBar: 2,
    }), now);
    const deck = provider.getDecks()[0];
    expect(deck?.track?.id).toBe("rb:222");
    expect(deck?.loopRoll?.active).toBe(false);
    expect(deck?.sync).toBe(false);
  });

  it("tracks a mid-loop track switch without carrying the loop generation", () => {
    const provider = new RkbxOscProvider({ now: () => now });
    const send = (address: string, value: number | string, atNs: bigint): void => {
      provider.ingestDatagram(encodeOscMessage({ address, args: [value] }), atNs);
    };
    send("/1/track/title", VIRTUAL_TRACK_A.title, now);
    send("/1/time", 30, now);
    send("/1/beat/subdiv/1", 4, now);
    const before = provider.getDecks()[0];
    const generationBefore = before?.generation ?? 0;
    send("/1/track/title", VIRTUAL_TRACK_B.title, now);
    send("/1/time", 0.5, now);
    const after = provider.getDecks()[0];
    expect((after?.generation ?? 0)).toBeGreaterThan(generationBefore);
    expect(after?.track?.title).toBe(VIRTUAL_TRACK_B.title);
  });

  it("fuses master from prolink and pitch from rkbx-osc per field authority", () => {
    now = 1_000n * 1_000_000_000n;
    const engine = new FusionEngine({ now: clock });
    const prolink = new ScriptedProvider({ id: "prolink", now: clock });
    const rkbx = new ScriptedProvider({ id: "rkbx-osc", now: clock });
    prolink.update({
      deckId: 1, track: { id: "rb:1", title: "Same" }, playing: true,
      playheadSeconds: 10, effectiveBpm: 128, master: true, sync: true, atNs: now,
    });
    rkbx.update({
      deckId: 1, track: { id: "rb:1", title: "Same" }, playing: true,
      playheadSeconds: 10, effectiveBpm: 128, pitchPercent: 2.0, master: false, atNs: now,
    });
    const prolinkDeck = prolink.getDecks()[0];
    const rkbxDeck = rkbx.getDecks()[0];
    if (!prolinkDeck || !rkbxDeck) throw new Error("scripted provider emitted no deck");
    engine.ingest("prolink", prolinkDeck);
    engine.ingest("rkbx-osc", rkbxDeck);
    const fused = engine.fused(1);
    expect(fused?.pitchPercent).toBe(2.0);
    expect(fused?.fieldSources.pitchPercent).toBe("rkbx-osc");
    expect(fused?.sync).toBe(true);
    expect(fused?.fieldSources.sync).toBe("prolink");
  });

  it("keeps FLX4 loop hints at estimated quality below DJ software truth", () => {
    now = 2_000n * 1_000_000_000n;
    const engine = new FusionEngine({ now: clock });
    const composite = new ScriptedProvider({ id: "composite-flx4", now: clock });
    const prolink = new ScriptedProvider({ id: "prolink", now: clock });
    composite.update({
      deckId: 1, track: { id: "rb:9", title: "Loop" }, playing: true,
      playheadSeconds: 40, effectiveBpm: 120,
      loopRoll: { active: true, beatLength: 4 },
      quality: { loopRoll: "estimated" },
      atNs: now,
    });
    prolink.update({
      deckId: 1, track: { id: "rb:9", title: "Loop" }, playing: true,
      playheadSeconds: 40, effectiveBpm: 120,
      loopRoll: { active: false, beatLength: null },
      quality: { loopRoll: "exact" },
      atNs: now,
    });
    const compositeDeck = composite.getDecks()[0];
    const prolinkDeck2 = prolink.getDecks()[0];
    if (!compositeDeck || !prolinkDeck2) throw new Error("scripted provider emitted no deck");
    engine.ingest("composite-flx4", compositeDeck);
    engine.ingest("prolink", prolinkDeck2);
    expect(engine.fused(1)?.loopRoll?.active).toBe(false);
    expect(engine.fused(1)?.fieldSources.loopRoll).toBe("prolink");
  });
});
