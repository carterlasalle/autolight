import { describe, expect, it, beforeEach } from "vitest";
import { FusionEngine } from "./fusion.js";
import { ScriptedProvider } from "./providers.js";
import { LightingIpcProvider, decodeLightingCaptureBase64, encodeLightingCaptureBase64, LIGHTING_CONTAINER_DECODER_V1 } from "./lighting-ipc.js";

let now = 1_000n * 1_000_000_000n;

const clock = (): bigint => now;

beforeEach(() => { now = 1_000n * 1_000_000_000n; });
describe("spec 120 item 15: the app runs every non-Lighting provider with SoundSwitch absent", () => {
  it("fuses rkbx-osc, prolink, ax, os2l and memory sources with no Lighting provider", () => {
    const engine = new FusionEngine({ now: clock });

    const sources: [string, ScriptedProvider][] = [
      ["rkbx-osc", new ScriptedProvider({ id: "rkbx-osc", now: clock })],
      ["prolink", new ScriptedProvider({ id: "prolink", now: clock })],
      ["ax", new ScriptedProvider({ id: "ax", now: clock })],
      ["os2l", new ScriptedProvider({ id: "os2l", now: clock })],
      ["memory-cleanroom", new ScriptedProvider({ id: "memory-cleanroom", now: clock })],
      ["composite-flx4", new ScriptedProvider({ id: "composite-flx4", now: clock })],
    ];

    const emit = (id: string, seconds: number): void => {
      const provider = sources.find(([sid]) => sid === id)?.[1];

      if (!provider) throw new Error(`unknown provider ${id}`);
      provider.update({
        deckId: 1, track: { id: "rb:1", title: "No SoundSwitch" }, playing: true,
        playheadSeconds: seconds, effectiveBpm: 128, atNs: now,
      });
      const deck = provider.getDecks()[0];

      if (!deck) throw new Error("scripted provider emitted no deck");
      engine.ingest(id, deck);
    };

    for (const [id] of sources) emit(id, 10);

    // Identical payloads: the first ingested provider (rkbx-osc) holds
    // playheadSeconds under the switchHoldMs hysteresis. The assertion pins
    // first-writer-wins determinism instead of a vacuous "not lighting-ipc".
    const fused = engine.fused(1);
    expect(fused).not.toBeNull();
    expect(fused?.playheadSeconds).toBe(10);
    expect(fused?.fieldSources.playheadSeconds).toBe("rkbx-osc");

    // Authority is still exercised: rkbx-osc goes silent while
    // memory-cleanroom keeps emitting, so it takes over via stale-takeover
    // (and lighting-ipc, which contributes nothing, never wins).
    now += 300n * 1_000_000n;
    emit("memory-cleanroom", 10.1);
    expect(engine.fused(1)?.fieldSources.playheadSeconds).toBe("rkbx-osc");
    now += 300n * 1_000_000n;
    emit("memory-cleanroom", 10.2);
    now += 300n * 1_000_000n;
    emit("memory-cleanroom", 10.3);
    now += 300n * 1_000_000n;
    emit("memory-cleanroom", 10.4);
    expect(engine.fused(1)?.fieldSources.playheadSeconds).toBe("memory-cleanroom");
    expect(engine.drainEvents().some((e) => e.reason === "stale-takeover" && e.to === "memory-cleanroom")).toBe(true);
    // An unavailable Lighting provider contributes no decks, so it never wins.
    const lighting = new LightingIpcProvider({ now: clock, fixtures: [] });
    expect(lighting.getDecks()).toHaveLength(0);
    expect(Object.values(engine.fused(1)?.fieldSources ?? {})).not.toContain("lighting-ipc");
  });

  it("reports the Lighting provider MISSING while every other provider goes live", async () => {
    const lighting = new LightingIpcProvider({ now: () => now, fixtures: [] });
    expect(lighting.capability()).toBe("MISSING");
    await lighting.start();
    expect(lighting.getStatus()).toMatchObject({ state: "unavailable" });
    await lighting.stop();

    // Every non-Lighting provider goes live alongside the missing Lighting one.
    const engine = new FusionEngine({ now: clock });
    const rkbx = new ScriptedProvider({ id: "rkbx-osc", now: clock });
    const memory = new ScriptedProvider({ id: "memory-cleanroom", now: clock });
    const emitLive = (provider: ScriptedProvider, seconds: number): void => {
      provider.update({
        deckId: 1, track: { id: "rb:live", title: "Live" }, playing: true,
        playheadSeconds: seconds, effectiveBpm: 128, atNs: now,
      });
      const deck = provider.getDecks()[0];

      if (!deck) throw new Error("scripted provider emitted no deck");
      engine.ingest(provider.id, deck);
    };

    emitLive(rkbx, 10);
    emitLive(memory, 10);

    // First ingested (rkbx-osc) holds under hysteresis; once it goes silent
    // while memory-cleanroom keeps emitting, memory-cleanroom takes over.
    expect(engine.fused(1)?.fieldSources.playheadSeconds).toBe("rkbx-osc");
    now += 300n * 1_000_000n;
    emitLive(memory, 10.1);
    now += 300n * 1_000_000n;
    emitLive(memory, 10.2);
    now += 300n * 1_000_000n;
    emitLive(memory, 10.3);
    now += 300n * 1_000_000n;
    emitLive(memory, 10.4);
    expect(engine.fused(1)?.fieldSources.playheadSeconds).toBe("memory-cleanroom");

    const ready = new LightingIpcProvider({
      now: () => now,
      fixtures: [{
        rekordboxVersion: "7.2.19", platform: "macos", action: "play", condition: "one-deck",
        capture: encodeLightingCaptureBase64([{ deck: 1, playing: true, playheadSeconds: 5 }]),
        decoder: LIGHTING_CONTAINER_DECODER_V1, expectedBy: "owner capture HW-RB-LIGHT-01",
      }],
    });

    expect(ready.capability()).toBe("READY");
    // The fixture capture must actually decode: a broken encode/decode path
    // is caught here, not just the fixture-presence capability check.
    const capture = encodeLightingCaptureBase64([{ deck: 1, playing: true, playheadSeconds: 5 }]);
    const replayed = ready.replayAll();
    expect(replayed.malformed).toEqual([]);
    expect(replayed.states).toHaveLength(1);
    expect(replayed.states[0]?.playheadSeconds).toBe(5);
    const decoded = decodeLightingCaptureBase64(capture);
    expect(decoded.malformed).toEqual([]);
    expect(decoded.frames).toHaveLength(1);
    await ready.stop();
  });
});
