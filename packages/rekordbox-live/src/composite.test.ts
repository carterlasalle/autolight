import { describe, expect, it } from "vitest";
import {
  COMPOSITE_PROVIDER_ID,
  CompositeProvider,
  correlateEnvelopes,
  estimateTempoRangePercent,
  gridBeatAt,
  gridBpmAt,
  matchLibraryAudio,
  mixReferences,
  type CompositeTrackResolution,
} from "./composite.js";
import { runProviderContractSuite, virtualClock, type ProviderContractSubject } from "./contract-suite.js";
function grid120(): { sourceTimeMs: number }[] {
  const out: { sourceTimeMs: number }[] = [];
  for (let i = 0; i < 64; i++) out.push({ sourceTimeMs: i * 500 });
  return out;
}

function resolution(id: string, withEnvelope: boolean): CompositeTrackResolution {
  // Deterministic pseudo-random envelope: unique alignment, so correlation
  // peaks at zero lag only when the loopback is aligned.
  let seed = 1234567;
  const next = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed % 1000) / 1000;
  };
  const envelope = withEnvelope
    ? Array.from({ length: 512 }, () => (next() > 0.7 ? 1 : 0.05 + next() * 0.2))
    : null;
  return {
    id,
    title: "Track",
    artist: "Suite",
    canonicalPath: `/music/${id}.mp3`,
    grid: grid120(),
    durationSeconds: 32,
    onsetEnvelope: envelope,
  };
}
describe("composite-flx4 provider (T-LIVE-07)", () => {
  it("is selectable under the fusion authority id", () => {
    const provider = new CompositeProvider({ now: () => 0n });
    expect(provider.id).toBe(COMPOSITE_PROVIDER_ID);
    expect(provider.id).toBe("composite-flx4");
  });

  it("estimates playhead from play plus tempo fader", () => {
    let now = 1_000_000_000_000n;
    const provider = new CompositeProvider({
      now: () => now,
      resolveTrack: () => resolution("rb:1", false),
      listOpenFiles: () => ["/music/a.mp3"],
      libraryRoots: ["/music"],
    });
    provider.ingestControllerEvent({ deck: 1, control: "load", value: 1, pad: null, atNs: now });
    now += 10_000_000n;
    provider.pollOpenFiles(now);
    now += 10_000_000n;
    provider.ingestControllerEvent({ deck: 1, control: "tempo", value: 0.75, pad: null, atNs: now });
    const playAt = now + 10_000_000n;
    provider.ingestControllerEvent({ deck: 1, control: "play", value: 1, pad: null, atNs: playAt });
    now = playAt + 1_000_000_000n;
    provider.tick(now);
    const deck = provider.getDecks().find((d) => d.deckId === 1);
    expect(deck?.playing).toBe(true);
    expect(deck?.playheadSeconds ?? 0).toBeGreaterThan(1);
    expect(deck?.playheadSeconds ?? 0).toBeCloseTo(1.05, 2);
    expect(deck?.quality.playheadSeconds).toBe("estimated");
    expect(deck?.quality.channelFader).toBe("exact");
  });

  it("resolves the loaded track from LOAD plus open files with a new generation", () => {
    let now = 2_000_000_000_000n;
    let resolveId = "rb:first";
    const provider = new CompositeProvider({
      now: () => now,
      resolveTrack: () => resolution(resolveId, false),
      listOpenFiles: () => ["/music/first.mp3"],
      libraryRoots: ["/music"],
    });
    provider.ingestControllerEvent({ deck: 1, control: "load", value: 1, pad: null, atNs: now });
    now += 5_000_000n;
    provider.pollOpenFiles(now);
    const first = provider.getDecks().find((d) => d.deckId === 1);
    expect(first?.track?.id).toBe("rb:first");
    const genA = first?.generation ?? -1;
    resolveId = "rb:second";
    now += 5_000_000n;
    provider.ingestControllerEvent({ deck: 1, control: "load", value: 1, pad: null, atNs: now });
    now += 5_000_000n;
    provider.pollOpenFiles(now);
    const second = provider.getDecks().find((d) => d.deckId === 1);
    expect(second?.track?.id).toBe("rb:second");
    expect((second?.generation ?? -1)).toBeGreaterThan(genA);
  });

  it("locks correlation below the 15 ms target on synthetic loopback audio", () => {
    let now = 3_000_000_000_000n;
    const provider = new CompositeProvider({
      now: () => now,
      resolveTrack: () => resolution("rb:lock", true),
      listOpenFiles: () => ["/music/lock.mp3"],
      libraryRoots: ["/music"],
      envelopeRateHz: 50,
      correlationWindowMs: 4000,
      lockThresholdMs: 15,
      minLockConfidence: 0.3,
      maxCorrectionMsPerTick: 50,
    });
    provider.ingestControllerEvent({ deck: 1, control: "load", value: 1, pad: null, atNs: now });
    now += 5_000_000n;
    provider.pollOpenFiles(now);
    now += 5_000_000n;
    provider.ingestControllerEvent({ deck: 1, control: "play", value: 1, pad: null, atNs: now });
    const deck = () => provider.getDecks().find((d) => d.deckId === 1);
    const envelope = resolution("rb:lock", true).onsetEnvelope ?? [];
    now += 3_000_000_000n;
    provider.tick(now);
    for (let i = 0; i < 10; i++) {
      now += 100_000_000n;
      const end = Math.max(0, Math.round((deck()?.playheadSeconds ?? 0) * 50));
      provider.pushAudio(envelope.slice(Math.max(0, end - 128), end));
      provider.tick(now);
    }
    expect(deck()?.quality.playheadSeconds).toBe("derived");
  });

  it("resolves master to the louder deck and keeps faders exact", () => {
    let now = 4_000_000_000_000n;
    const provider = new CompositeProvider({
      now: () => now,
      resolveTrack: (deck) => resolution(deck === 1 ? "rb:a" : "rb:b", false),
      listOpenFiles: () => ["/music/a.mp3", "/music/b.mp3"],
      libraryRoots: ["/music"],
    });
    for (const deck of [1, 2] as const) {
      provider.ingestControllerEvent({ deck, control: "load", value: 1, pad: null, atNs: now });
    }
    now += 5_000_000n;
    provider.pollOpenFiles(now);
    now += 5_000_000n;
    provider.ingestControllerEvent({ deck: 1, control: "channel-fader", value: 0.9, pad: null, atNs: now });
    provider.ingestControllerEvent({ deck: 2, control: "channel-fader", value: 0.2, pad: null, atNs: now });
    provider.ingestControllerEvent({ deck: 0, control: "crossfader", value: 0.1, pad: null, atNs: now });
    now += 5_000_000n;
    provider.ingestControllerEvent({ deck: 1, control: "play", value: 1, pad: null, atNs: now });
    provider.ingestControllerEvent({ deck: 2, control: "play", value: 1, pad: null, atNs: now });
    const a = provider.getDecks().find((d) => d.deckId === 1);
    const b = provider.getDecks().find((d) => d.deckId === 2);
    expect(a?.master).toBe(true);
    expect(b?.master).toBe(false);
    expect(a?.channelFader).toBeCloseTo(0.9, 3);
    expect(a?.fieldSources.channelFader).toBe("composite-flx4");
  });

  it("passes the shared contract suite with a virtual MIDI timeline", async () => {
    const clock = virtualClock();
    let pendingTitle: { id: string; title: string } | null = null;
    const provider = new CompositeProvider({
      now: () => clock.nowNs(),
      resolveTrack: () =>
        pendingTitle === null
          ? null
          : {
              id: pendingTitle.id,
              title: pendingTitle.title,
              artist: "Suite",
              canonicalPath: "/music/suite.mp3",
              grid: grid120(),
              durationSeconds: 32,
              onsetEnvelope: null,
            },
      listOpenFiles: () => ["/music/suite.mp3"],
      libraryRoots: ["/music"],
    });
    const subject: ProviderContractSubject = {
      provider,
      reportsTrackText: true,
      advance: async (ms) => {
        clock.advance(ms);
        provider.tick(clock.nowNs());
      },
      loadTrack: async (deckId, track) => {
        clock.advance(10);
        const deck = (deckId === 2 ? 2 : 1) as 1 | 2;
        pendingTitle = { id: track.id, title: track.title };
        provider.ingestControllerEvent({ deck, control: "load", value: 1, pad: null, atNs: clock.nowNs() });
        clock.advance(10);
        provider.pollOpenFiles(clock.nowNs());
        clock.advance(10);
        provider.ingestControllerEvent({ deck, control: "play", value: 1, pad: null, atNs: clock.nowNs() });
      },
      malformed: async () => provider.ingestMalformed(),
      cleanup: async () => {},
    };
    const failures = await runProviderContractSuite(subject);
    expect(failures).toHaveLength(0);
  });

  it("rejects malformed input without failing", async () => {
    const clock = virtualClock();
    const provider = new CompositeProvider({ now: () => clock.nowNs() });
    await provider.start();
    provider.ingestMalformed("garbage bytes");
    expect(provider.malformedCounted()).toBe(1);
    expect(provider.getStats().rejected).toBe(1);
    expect(provider.getStatus().state).not.toBe("failed");
    await provider.stop();
  });

  it("matches library audio files and ignores the rest", () => {
    const files = [
      "/music/set/opener.mp3",
      "/music/set/notes.txt",
      "/tmp/stray.wav",
      "/music/set/closer.FLAC",
    ];
    expect(matchLibraryAudio(files, ["/music"])).toEqual([
      "/music/set/opener.mp3",
      "/music/set/closer.FLAC",
    ]);
    expect(matchLibraryAudio(files, ["/music/set"])).toEqual([
      "/music/set/opener.mp3",
      "/music/set/closer.FLAC",
    ]);
  });

  it("maps grid beats and tempo", () => {
    const grid = grid120();
    expect(gridBeatAt(grid, 0.25)).toBeCloseTo(0.5, 6);
    expect(gridBeatAt([], 1)).toBeNull();
    expect(gridBpmAt(grid, 1)).toBeCloseTo(120, 6);
    expect(gridBpmAt([{ sourceTimeMs: 0 }], 1)).toBeNull();
  });

  it("correlates envelopes and mixes references by fader weight", () => {
    const ref = [1, 0.1, 0.2, 0.1, 0.9, 0.15, 0.3, 0.1, 0.8, 0.2, 0.1, 0.4, 0.7, 0.1, 0.2, 0.1];
    const live = ref.slice(0);
    const { lagSamples, confidence } = correlateEnvelopes(live, ref, 8);
    expect(lagSamples).toBe(0);
    expect(confidence).toBeGreaterThan(0.99);
    const mixed = mixReferences([ref, ref.map((v) => v * 2)], [1, 0]);
    expect(mixed[0]).toBeCloseTo(1, 6);
    const silent = mixReferences([ref], [0]);
    expect(silent.every((v) => v === 0)).toBe(true);
  });

  it("fits the tempo range from fader plus pitch samples", () => {
    const samples = [
      { fader: 0.75, pitchFraction: 0.05 },
      { fader: 0.25, pitchFraction: -0.05 },
      { fader: 0.5, pitchFraction: 0 },
    ];
    expect(estimateTempoRangePercent(samples)).toBeCloseTo(10, 6);
    expect(estimateTempoRangePercent([{ fader: 0.5, pitchFraction: 0 }])).toBeNull();
  });
});
