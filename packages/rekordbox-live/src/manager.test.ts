// P-7-priority probe (matrix row 7, T-LIVE-02): with Lighting IPC and
// Composite FLX4 both emitting, Lighting wins; when Lighting stops for longer
// than live.provider.staleMs, Composite takes over after the switch hold; with
// both silent the fused state keeps its last value labelled stale (the
// adaptive clock takes over downstream in T-RUN, not here).
import { describe, expect, it } from "vitest";
import { FusionEngine } from "./fusion.js";
import { ScriptedProvider } from "./providers.js";

describe("P-7-priority", () => {
  it("Lighting wins, Composite takes over after staleness, then the holder goes stale", () => {
    let now = 5_000n * 1_000_000_000n;
    const engine = new FusionEngine({ now: () => now });
    const lighting = new ScriptedProvider({ id: "lighting-ipc", now: () => now });
    const composite = new ScriptedProvider({ id: "composite-flx4", now: () => now });
    const emit = (provider: ScriptedProvider, seconds: number): void => {
      provider.update({
        deckId: 1,
        track: { id: "t1", title: "Track" },
        playing: true,
        playheadSeconds: seconds,
        effectiveBpm: 128,
        atNs: now,
      });
      engine.ingest(provider.id, provider.getDecks()[0]!);
    };

    emit(lighting, 10);
    emit(composite, 10.05);
    expect(engine.fused(1)?.fieldSources.playheadSeconds).toBe("lighting-ipc");

    // Lighting stops; Composite keeps emitting. The takeover waits out both
    // live.provider.staleMs and live.fusion.switchHoldMs.
    now += 300n * 1_000_000n;
    emit(composite, 10.1);
    expect(engine.fused(1)?.fieldSources.playheadSeconds).toBe("lighting-ipc");
    now += 300n * 1_000_000n;
    emit(composite, 10.2);
    expect(engine.fused(1)?.fieldSources.playheadSeconds).toBe("lighting-ipc");
    expect(engine.fused(1)?.quality.playheadSeconds).toBe("stale");
    now += 300n * 1_000_000n;
    emit(composite, 10.3);
    expect(engine.fused(1)?.fieldSources.playheadSeconds).toBe("lighting-ipc");
    now += 300n * 1_000_000n;
    emit(composite, 10.4);
    expect(engine.fused(1)?.fieldSources.playheadSeconds).toBe("composite-flx4");
    expect(engine.drainEvents().some((e) => e.reason === "stale-takeover" && e.to === "composite-flx4")).toBe(true);

    // Both silent: the last value stays with the stale label and no new
    // authority is invented.
    now += 2_000n * 1_000_000n;
    engine.refresh();
    expect(engine.fused(1)?.fieldSources.playheadSeconds).toBe("composite-flx4");
    expect(engine.fused(1)?.quality.playheadSeconds).toBe("stale");
    expect(engine.fused(1)?.playheadSeconds).toBe(10.4);
  });

  it("uses the composite provider for a field Lighting never supplies", () => {
    let now = 5_000n * 1_000_000_000n;
    const engine = new FusionEngine({ now: () => now });
    const lighting = new ScriptedProvider({ id: "lighting-ipc", now: () => now });
    const composite = new ScriptedProvider({ id: "composite-flx4", now: () => now });
    lighting.update({ deckId: 1, track: { id: "t1", title: "Track" }, playing: true, playheadSeconds: 10, effectiveBpm: 128, atNs: now });
    composite.update({ deckId: 1, track: { id: "t1", title: "Track" }, playing: true, playheadSeconds: 10.05, effectiveBpm: 128, channelFader: 0.7, atNs: now });
    engine.ingest("lighting-ipc", lighting.getDecks()[0]!);
    engine.ingest("composite-flx4", composite.getDecks()[0]!);
    const fused = engine.fused(1);
    expect(fused?.fieldSources.playheadSeconds).toBe("lighting-ipc");
    expect(fused?.channelFader).toBe(0.7);
    expect(fused?.fieldSources.channelFader).toBe("composite-flx4");
  });
});
