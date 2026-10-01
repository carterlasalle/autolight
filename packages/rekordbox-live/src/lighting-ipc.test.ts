import { describe, expect, it } from "vitest";
import {
  LIGHTING_CONTAINER_DECODER_V1,
  LIGHTING_MATRIX_ACTIONS,
  LIGHTING_MATRIX_CONDITIONS,
  LIGHTING_SURFACES,
  LightingIpcProvider,
  decodeLightingCapture,
  decodeLightingCaptureBase64,
  encodeLightingCapture,
  encodeLightingCaptureBase64,
  lightingFixturePath,
  lightingMatrixCells,
  lintLightingFixture,
  parseLightingFixture,
  replayLightingCapture,
  validateSurfaceInventory,
  type LightingEvent,
} from "./lighting-ipc.js";
import { DeckGenerationMapper } from "./providers.js";
import { runProviderContractSuite, virtualClock } from "./contract-suite.js";

function fixture(events: LightingEvent[], action = "play") {
  return {
    rekordboxVersion: "7.2.19",
    platform: "macos" as const,
    action,
    condition: "one-deck",
    capture: encodeLightingCaptureBase64(events),
    decoder: LIGHTING_CONTAINER_DECODER_V1,
    expectedBy: "owner capture HW-RB-LIGHT-01",
  };
}

describe("lighting IPC codec (T-LIVE-09)", () => {
  it("round-trips framed events through the real decoder", () => {
    const bytes = encodeLightingCapture([
      { deck: 1, playing: true, playheadSeconds: 12.5, effectiveBpm: 128 },
      { deck: 2, playing: false, playheadSeconds: 0, channelFader: 0.8 },
    ]);
    const decoded = decodeLightingCapture(bytes);
    expect(decoded.malformed).toEqual([]);
    expect(decoded.frames).toHaveLength(2);
    expect(decoded.frames[0]?.event.deck).toBe(1);
    expect(decoded.frames[1]?.event.channelFader).toBe(0.8);
    const again = decodeLightingCapture(encodeLightingCapture(decoded.frames.map((f) => ({ ...f.event }))));
    expect(again.frames).toHaveLength(2);
  });

  it("keeps unknown fields under raw and rejects truncated frames (P-9.5)", () => {
    const fieldBytes = encodeLightingCapture([{ deck: 1, playing: true, futureField: "kept" }]);
    const fieldDecoded = decodeLightingCapture(fieldBytes);
    expect(fieldDecoded.frames[0]?.raw["futureField"]).toBe("kept");
    const truncBytes = encodeLightingCapture([{ deck: 1, playing: true, playheadSeconds: 1 }]);
    expect(decodeLightingCapture(truncBytes.slice(0, truncBytes.length - 2)).malformed.length).toBeGreaterThan(0);
    expect(decodeLightingCapture(new Uint8Array([0, 0])).malformed.length).toBeGreaterThan(0);
    expect(decodeLightingCaptureBase64("").malformed.length).toBeGreaterThan(0);
    expect(decodeLightingCaptureBase64("handwritten-synthetic: nothing").malformed.length).toBeGreaterThan(0);
    expect(decodeLightingCaptureBase64("!!!not-base64!!!").frames).toHaveLength(0);
  });

  it("rejects empty captures in the fixture lint (P-9.4)", () => {
    expect(lintLightingFixture({ ...fixture([{ deck: 1 }]), capture: "" }).length).toBeGreaterThan(0);
    expect(lintLightingFixture({ ...fixture([{ deck: 1 }]), expectedBy: "lighting decoder v1" }).length).toBeGreaterThan(0);
    expect(lintLightingFixture({ ...fixture([{ deck: 1 }]), capture: "handwritten-synthetic: nothing" }).length).toBeGreaterThan(0);
    expect(lintLightingFixture(fixture([{ deck: 1 }]))).toEqual([]);
    expect(() => parseLightingFixture({})).toThrow();
  });

  it("replays through the real decoder at 1x, 2x, 10x (P-128)", () => {
    const f = fixture([
      { deck: 1, playing: true, playheadSeconds: 10, effectiveBpm: 128 },
      { deck: 1, playing: true, playheadSeconds: 11, effectiveBpm: 128 },
    ]);
    const at1 = replayLightingCapture(f, new DeckGenerationMapper(), { rate: 1, stepMs: 100 });
    const at2 = replayLightingCapture(f, new DeckGenerationMapper(), { rate: 2, stepMs: 100 });
    const at10 = replayLightingCapture(f, new DeckGenerationMapper(), { rate: 10, stepMs: 100 });
    expect(at1.malformed).toEqual([]);
    expect(at1.states).toHaveLength(2);
    expect(at2.states).toHaveLength(2);
    expect(at10.states).toHaveLength(2);
    const first = at1.states[0];
    const second = at1.states[1];
    expect(first?.playheadSeconds).toBe(10);
    expect(first && second ? second.receivedAtNs - first.receivedAtNs : 0n).toBe(100_000_000n);
    const first2 = at2.states[0];
    const second2 = at2.states[1];
    expect(first2 && second2 ? second2.receivedAtNs - first2.receivedAtNs : 0n).toBe(50_000_000n);
    const first10 = at10.states[0];
    const second10 = at10.states[1];
    expect(first10 && second10 ? second10.receivedAtNs - first10.receivedAtNs : 0n).toBe(10_000_000n);
    expect(first?.fieldSources.playheadSeconds).toBe("lighting-ipc");
  });

  it("maps master, loop, pitch, sync, hotcue and roll from events (T-LIVE-14)", () => {
    const f = fixture([{
      deck: 1, playing: true, playheadSeconds: 20, master: true,
      loopActive: true, loopBeatLength: 4, pitchPercent: 1.5, sync: true,
      hotCue: 2, rollActive: true, rollBeats: 0.5, trackId: "rb:1", title: "Track",
    }], "loop-roll");
    const { states } = replayLightingCapture(f, new DeckGenerationMapper());
    const state = states[0];
    expect(state?.master).toBe(true);
    expect(state?.loopRoll).toMatchObject({ active: true, beatLength: 4 });
    expect(state?.pitchPercent).toBe(1.5);
    expect(state?.sync).toBe(true);
    expect(state?.lastHotCue?.number).toBe(2);
    expect(state?.generation).toBe(1);
    expect(state?.quality.playheadSeconds).toBe("exact");
  });

  it("covers the 27 by 7 matrix rows and the spec 9.2 surface list", () => {
    expect(LIGHTING_MATRIX_ACTIONS).toHaveLength(27);
    expect(LIGHTING_MATRIX_CONDITIONS).toHaveLength(7);
    expect(lightingMatrixCells()).toHaveLength(189);
    expect(lightingFixturePath("7.2.19", "macos", { action: "play", condition: "one-deck" }))
      .toBe("protocol-fixtures/rekordbox/7.2.19/macos/play-one-deck/capture.json");
    expect(LIGHTING_SURFACES).toContain("tcp");
    expect(validateSurfaceInventory({ rekordboxVersion: "7.2.19", platform: "macos", surfaces: {} })).toContain("tcp");
    expect(validateSurfaceInventory({
      rekordboxVersion: "7.2.19",
      platform: "macos",
      surfaces: Object.fromEntries(LIGHTING_SURFACES.map((s) => [s, { observed: true, detail: "seen" }])),
    })).toEqual([]);
  });

  it("reports MISSING with the owner remedy until captures land", async () => {
    const clock = virtualClock();
    const provider = new LightingIpcProvider({ now: () => clock.nowNs(), fixtures: [] });
    expect(provider.capability()).toBe("MISSING");
    await provider.start();
    expect(provider.getStatus().state).toBe("unavailable");
    await provider.stop();
    const ready = new LightingIpcProvider({ now: () => clock.nowNs(), fixtures: [fixture([{ deck: 1, playing: true }])] });
    expect(ready.capability()).toBe("READY");
    await ready.start();
    const replayed = ready.replayAll();
    expect(replayed.states).toHaveLength(1);
    expect(ready.getStatus().state).toBe("live");
    await ready.stop();
  });

  it("passes the shared contract suite on event ingest", async () => {
    const clock = virtualClock();
    const provider = new LightingIpcProvider({ now: () => clock.nowNs(), fixtures: [] });
    const failures = await runProviderContractSuite({
      provider,
      reportsTrackText: true,
      advance: async (ms: number) => {
        clock.advance(ms);
        provider.ingestEvent({ deck: 1, playing: true, playheadSeconds: 1 }, clock.nowNs());
      },
      loadTrack: async (deckId: number, track: { id: string; title: string; artist: string }) => {
        clock.advance(10);
        provider.ingestEvent({
          deck: deckId, playing: true, playheadSeconds: 0,
          trackId: track.id, title: track.title, artist: track.artist,
        }, clock.nowNs());
      },
      malformed: async () => {
        provider.ingestBytes(new Uint8Array([0, 0]), clock.nowNs());
      },
      cleanup: async () => {},
    });
    expect(failures).toEqual([]);
  });
});
