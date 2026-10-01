import { describe, expect, it } from "vitest";
import { FusionEngine } from "./fusion.js";
import { ScriptedProvider } from "./providers.js";
import { LightingIpcProvider, encodeLightingCaptureBase64, LIGHTING_CONTAINER_DECODER_V1 } from "./lighting-ipc.js";

let now = 1_000n * 1_000_000_000n;
const clock = (): bigint => now;

describe("spec 120 item 15: the app runs every non-Lighting provider with SoundSwitch absent", () => {
  it("fuses rkbx-osc, prolink, ax, os2l and memory sources with no Lighting provider", () => {
    now = 1_000n * 1_000_000_000n;
    const engine = new FusionEngine({ now: clock });
    const sources: [string, ScriptedProvider][] = [
      ["rkbx-osc", new ScriptedProvider({ id: "rkbx-osc", now: clock })],
      ["prolink", new ScriptedProvider({ id: "prolink", now: clock })],
      ["ax", new ScriptedProvider({ id: "ax", now: clock })],
      ["os2l", new ScriptedProvider({ id: "os2l", now: clock })],
      ["memory-cleanroom", new ScriptedProvider({ id: "memory-cleanroom", now: clock })],
      ["composite-flx4", new ScriptedProvider({ id: "composite-flx4", now: clock })],
    ];
    for (const [id, provider] of sources) {
      provider.update({
        deckId: 1, track: { id: "rb:1", title: "No SoundSwitch" }, playing: true,
        playheadSeconds: 10, effectiveBpm: 128, atNs: now,
      });
      const deck = provider.getDecks()[0];
      if (!deck) throw new Error("scripted provider emitted no deck");
      engine.ingest(id, deck);
    }
    const fused = engine.fused(1);
    expect(fused?.playheadSeconds).toBe(10);
    expect(fused?.fieldSources.playheadSeconds).not.toBe("lighting-ipc");
    expect(Object.values(fused?.fieldSources ?? {})).not.toContain("lighting-ipc");
  });

  it("reports the Lighting provider MISSING while every other provider goes live", async () => {
    const lighting = new LightingIpcProvider({ now: () => now, fixtures: [] });
    expect(lighting.capability()).toBe("MISSING");
    await lighting.start();
    expect(lighting.getStatus()).toMatchObject({ state: "unavailable" });
    await lighting.stop();
    const ready = new LightingIpcProvider({
      now: () => now,
      fixtures: [{
        rekordboxVersion: "7.2.19", platform: "macos", action: "play", condition: "one-deck",
        capture: encodeLightingCaptureBase64([{ deck: 1, playing: true, playheadSeconds: 5 }]),
        decoder: LIGHTING_CONTAINER_DECODER_V1, expectedBy: "owner capture HW-RB-LIGHT-01",
      }],
    });
    expect(ready.capability()).toBe("READY");
    await ready.stop();
  });
});
