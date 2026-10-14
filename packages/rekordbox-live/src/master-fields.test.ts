import { describe, expect, it } from "vitest";
import { buildStatusPacket } from "./prolink.js";
import { ProlinkProvider } from "./prolink-provider.js";
import { encodeOscMessage } from "./osc.js";
import { RkbxOscProvider } from "./rkbx-osc.js";
import { FusionEngine } from "./fusion.js";
import { ScriptedProvider } from "./providers.js";
import { VIRTUAL_TRACK_A, VIRTUAL_TRACK_B } from "./test-tracks.js";

// Fresh virtual clock per test: a shared mutable module binding makes the
// tests order-dependent (staleness/ordering change when tests reorder), so
// each test owns its own `now` cell closed over by its clock.
function freshClock(startNs = 1_000n * 1_000_000_000n): { now: () => bigint; advance: (ns: bigint) => void; current: () => bigint } {
  let now = startNs;
  return { now: () => now, advance: (ns: bigint): void => { now += ns; }, current: () => now };
}

describe("master deck, loop, pitch, SYNC, hotcue and roll (T-LIVE-14)", () => {
  it("clears the prolink loop and beat counter on track replacement", () => {
    const clock = freshClock();
    const provider = new ProlinkProvider({ now: clock.now });

    provider.ingestPacket(buildStatusPacket({
      deviceName: "CDJ-1", deviceNumber: 1, trackId: 111, trackSlot: 1,
      playState: 4, master: true, sync: true, beatInBar: 1,
    }), clock.current());
    expect(provider.getDecks()[0]?.loopRoll?.active).toBe(true);
    provider.ingestPacket(buildStatusPacket({
      deviceName: "CDJ-1", deviceNumber: 1, trackId: 222, trackSlot: 1,
      playState: 3, master: true, sync: false, beatInBar: 2,
    }), clock.current());
    const deck = provider.getDecks()[0];

    expect(deck?.track?.id).toBe("rb:222");
    expect(deck?.loopRoll?.active).toBe(false);
    expect(deck?.sync).toBe(false);
  });

  it("tracks a mid-loop track switch without carrying the loop generation", () => {
    const clock = freshClock();
    const provider = new RkbxOscProvider({ now: clock.now });

    const send = (address: string, value: number | string, atNs: bigint): void => {
      provider.ingestDatagram(encodeOscMessage({ address, args: [value] }), atNs);
    };

    send("/1/track/title", VIRTUAL_TRACK_A.title, clock.current());
    send("/1/time", 30, clock.current());
    send("/1/beat/subdiv/1", 4, clock.current());
    const before = provider.getDecks()[0];
    const generationBefore = before?.generation ?? 0;

    send("/1/track/title", VIRTUAL_TRACK_B.title, clock.current());
    send("/1/time", 0.5, clock.current());
    const after = provider.getDecks()[0];

    expect((after?.generation ?? 0)).toBeGreaterThan(generationBefore);
    expect(after?.track?.title).toBe(VIRTUAL_TRACK_B.title);
  });

  it("fuses master from prolink and pitch from rkbx-osc per field authority", () => {
    const clock = freshClock();
    const now = clock.current();
    const engine = new FusionEngine({ now: clock.now });
    const prolink = new ScriptedProvider({ id: "prolink", now: clock.now });
    const rkbx = new ScriptedProvider({ id: "rkbx-osc", now: clock.now });

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
    const clock = freshClock(2_000n * 1_000_000_000n);
    const engine = new FusionEngine({ now: clock.now });
    const composite = new ScriptedProvider({ id: "composite-flx4", now: clock.now });
    const prolink = new ScriptedProvider({ id: "prolink", now: clock.now });

    composite.update({
      deckId: 1, track: { id: "rb:9", title: "Loop" }, playing: true,
      playheadSeconds: 40, effectiveBpm: 120,
      loopRoll: { active: true, beatLength: 4 },
      quality: { loopRoll: "estimated" },
      atNs: clock.current(),
    });
    prolink.update({
      deckId: 1, track: { id: "rb:9", title: "Loop" }, playing: true,
      playheadSeconds: 40, effectiveBpm: 120,
      loopRoll: { active: false, beatLength: null },
      quality: { loopRoll: "exact" },
      atNs: clock.current(),
    });
    const compositeDeck = composite.getDecks()[0];
    const prolinkDeck2 = prolink.getDecks()[0];

    if (!compositeDeck || !prolinkDeck2) throw new Error("scripted provider emitted no deck");
    engine.ingest("composite-flx4", compositeDeck);
    engine.ingest("prolink", prolinkDeck2);
    // Hysteresis: the higher-authority challenger does not flip the field
    // on the first packet. It must stay fresh past live.fusion.switchHoldMs.
    expect(engine.fused(1)?.loopRoll?.active).toBe(true);
    expect(engine.fused(1)?.fieldSources.loopRoll).toBe("composite-flx4");
    clock.advance(600n * 1_000_000n);
    prolink.update({
      deckId: 1, track: { id: "rb:9", title: "Loop" }, playing: true,
      playheadSeconds: 40, effectiveBpm: 120,
      loopRoll: { active: false, beatLength: null },
      quality: { loopRoll: "exact" },
      atNs: clock.current(),
    });
    const prolinkFresh = prolink.getDecks()[0];

    if (!prolinkFresh) throw new Error("scripted provider emitted no deck");
    engine.ingest("prolink", prolinkFresh);
    expect(engine.fused(1)?.loopRoll?.active).toBe(false);
    expect(engine.fused(1)?.fieldSources.loopRoll).toBe("prolink");
  });
});
