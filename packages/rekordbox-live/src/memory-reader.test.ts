import { describe, expect, it } from "vitest";
import {
  MEMORY_PROVIDER_ID,
  MapMemoryAccessor,
  MemoryCleanroomProvider,
  lintOffsetsFile,
  parseOffsetsFile,
  qualifyOffsets,
  readMemorySample,
  scanMemoryOffsets,
} from "./memory-reader.js";
import { runProviderContractSuite, virtualClock } from "./contract-suite.js";

function offsets() {
  return {
    rekordboxVersion: "7.2.18",
    platform: "macos" as const,
    date: "2026-10-01",
    verification: { restarts: 2, observations: 4, maxErrorMs: 5, runbook: "HW-RB-MEM-01" },
    paths: [
      { field: "playheadSamples" as const, base: "deck", offsets: [0], sampleRateHz: 44100 },
      { field: "bpm" as const, base: "deck", offsets: [1] },
      { field: "masterDeck" as const, base: "deck", offsets: [2] },
      { field: "trackId" as const, base: "deck", offsets: [3] },
    ],
  };
}

type OffsetField = "playheadSamples" | "bpm" | "masterDeck" | "trackId";

// Both writers (the accessor and the contract-suite harness) derive their
// slot indices from the offsets fixture, so a layout change cannot drift
// silently between the declared paths and the bytes written.
function slotIndex(field: OffsetField): number {
  const path = offsets().paths.find((p) => p.field === field);
  const index = path?.offsets[0];

  if (index === undefined) throw new Error(`offsets fixture lacks ${field}`);

  return index;
}

function accessor(): MapMemoryAccessor {
  const memory = new MapMemoryAccessor();
  memory.writeU64("deck1", slotIndex("playheadSamples"), BigInt(Math.round(12.5 * 44100)));
  memory.writeF64("deck1", slotIndex("bpm"), 128);
  memory.writeU32("deck1", slotIndex("masterDeck"), 1);
  memory.writeU32("deck1", slotIndex("trackId"), 555);

  return memory;
}

describe("clean-room memory reader (T-LIVE-11)", () => {
  it("parses and lints the versioned offsets file", () => {
    expect(parseOffsetsFile(offsets()).rekordboxVersion).toBe("7.2.18");
    expect(lintOffsetsFile(offsets())).toEqual([]);
    // The lint names the specific missing or wrong keys, not one generic
    // failure: an empty object reports each required top-level field...
    const empty = lintOffsetsFile({});

    expect(empty).toHaveLength(1);
    for (const key of ["rekordboxVersion", "platform", "date", "verification", "paths"]) {
      expect(empty[0]).toContain(key);
    }
    // ...and a partially-populated object pinpoints the broken subtree.
    const missingRunbook = lintOffsetsFile({ ...offsets(), verification: { restarts: 2, observations: 4, maxErrorMs: 5 } });

    expect(missingRunbook).toHaveLength(1);
    expect(missingRunbook[0]).toContain("runbook");
    const badPlatform = lintOffsetsFile({ ...offsets(), platform: "linux" });

    expect(badPlatform).toHaveLength(1);
    expect(badPlatform[0]).toContain("platform");
  });

  it("stays off on unknown versions with UNVERIFIED REKORDBOX VERSION", () => {
    const qualification = qualifyOffsets(offsets(), "9.9.9", "macos");
    expect(qualification.qualified).toBe(false);
    expect(qualification.reason).toContain("UNVERIFIED REKORDBOX VERSION");
    expect(qualifyOffsets(offsets(), "7.2.18", "macos").qualified).toBe(true);
    expect(qualifyOffsets(offsets(), "7.2.18", "windows").qualified).toBe(false);
  });

  it("requires enable plus consent before reading (consent gate)", async () => {
    const base = { installedVersion: "7.2.18", platform: "macos" as const, offsets: offsets(), accessor: accessor() };
    const clock = virtualClock();
    const make = (overrides: Record<string, unknown>): MemoryCleanroomProvider =>
      new MemoryCleanroomProvider({ ...base, now: () => clock.nowNs(), ...overrides });

    // Each failing gate is started and polled: a provider that still emitted
    // decks from the accessor despite the gate would fail here.
    const disabled = make({ enabled: false, consentGranted: true });

    expect(disabled.capability()).toBe("MISSING");
    await disabled.start();
    expect(disabled.getStatus().state).toBe("unavailable");
    clock.advance(100);
    disabled.poll(clock.nowNs());
    expect(disabled.getDecks()).toHaveLength(0);
    await disabled.stop();

    const noConsent = make({ enabled: true, consentGranted: false });

    expect(noConsent.capability()).toBe("CONSENT_REQUIRED");
    await noConsent.start();
    expect(noConsent.getStatus().state).toBe("unavailable");
    clock.advance(100);
    noConsent.poll(clock.nowNs());
    expect(noConsent.getDecks()).toHaveLength(0);
    await noConsent.stop();

    const wrongVersion = make({ enabled: true, consentGranted: true, installedVersion: "9.9.9" });

    expect(wrongVersion.capability()).toBe("UNAVAILABLE_ON_THIS_DEVICE");
    await wrongVersion.start();
    expect(wrongVersion.getStatus().state).toBe("unavailable");
    clock.advance(100);
    wrongVersion.poll(clock.nowNs());
    expect(wrongVersion.getDecks()).toHaveLength(0);
    await wrongVersion.stop();

    // The READY provider runs its real lifecycle: starting on start(), live
    // once a poll finds samples.
    const ready = make({ enabled: true, consentGranted: true });

    expect(ready.capability()).toBe("READY");
    await ready.start();
    expect(ready.getStatus().state).toBe("starting");
    clock.advance(100);
    ready.poll(clock.nowNs());
    expect(ready.getStatus().state).toBe("live");
    expect(ready.getDecks().length).toBeGreaterThan(0);
    await ready.stop();
  });

  it("reads deck state from the accessor with exact playhead quality", () => {
    const samples = readMemorySample(accessor(), offsets(), (deck) => `deck${deck}`);
    expect(samples.get(1)?.bpm).toBe(128);
    expect(samples.get(1)?.trackId).toBe(555);
    const clock = virtualClock();

    const provider = new MemoryCleanroomProvider({
      now: () => clock.nowNs(), enabled: true, consentGranted: true,
      installedVersion: "7.2.18", platform: "macos", offsets: offsets(), accessor: accessor(),
    });

    provider.poll(clock.nowNs());
    const decks = provider.getDecks();
    expect(decks).toHaveLength(1);
    expect(decks[0]?.playheadSeconds).toBeCloseTo(12.5, 6);
    expect(decks[0]?.effectiveBpm).toBe(128);
    expect(decks[0]?.master).toBe(true);
    expect(decks[0]?.track?.id).toBe("rb:555");
    expect(decks[0]?.quality.playheadSeconds).toBe("exact");
    expect(provider.getStatus().state).toBe("live");
  });

  it("scans candidate paths from known observations against the test target", () => {
    // Two observations across two readers: candidates must match the SAME
    // slot in both, so a single-observation false positive cannot survive.
    const first = new MapMemoryAccessor();
    first.writeU64("region", 9, BigInt(Math.round(30 * 44100)));
    first.writeF64("region", 4, 174);
    first.writeU32("region", 6, 777);
    // Decoy: matches observation 1's playhead but has no counterpart in the
    // second reader, so it must not be returned.
    first.writeU64("region", 8, BigInt(Math.round(30 * 44100)));
    const second = new MapMemoryAccessor();
    second.writeU64("region", 9, BigInt(Math.round(60 * 44100)));
    second.writeF64("region", 4, 90);
    second.writeU32("region", 6, 888);

    const found = scanMemoryOffsets(
      [first, second], ["region"], 16,
      [
        { deck: 1, playheadSeconds: 30, bpm: 174, trackId: 777 },
        { deck: 2, playheadSeconds: 60, bpm: 90, trackId: 888 },
      ],
      44100,
    );

    // Exact tuples, not just field names: a scanner labelling the right
    // fields at the wrong slots would fail this.
    expect(found).toEqual([
      { field: "bpm", base: "region", offsets: [4] },
      { field: "trackId", base: "region", offsets: [6] },
      { field: "playheadSamples", base: "region", offsets: [9], sampleRateHz: 44100 },
    ]);
    expect(MEMORY_PROVIDER_ID).toBe("memory-cleanroom");
  });

  it("passes the shared contract suite on helper poll", async () => {
    const clock = virtualClock();
    const memory = new MapMemoryAccessor();
    let generation = 0;

    const provider = new MemoryCleanroomProvider({
      now: () => clock.nowNs(), enabled: true, consentGranted: true,
      installedVersion: "7.2.18", platform: "macos", offsets: offsets(), accessor: memory,
    });

    const failures = await runProviderContractSuite({
      provider,
      reportsTrackText: false,
      advance: async (ms: number) => {
        clock.advance(ms);
        provider.poll(clock.nowNs());
      },
      loadTrack: async (deckId: number, track: { id: string; title: string; artist: string }) => {
        void track;
        clock.advance(10);
        generation += 1;
        const numeric = 1000 + generation * 10 + deckId;
        // Values vary per generation so a frozen or wrongly-reset playhead
        // and a broken track-id mapping cannot pass unnoticed.
        const playheadSeconds = 0.5 + generation * 0.25;

        memory.writeU64(`deck${deckId}`, slotIndex("playheadSamples"), BigInt(Math.round(playheadSeconds * 44100)));
        memory.writeF64(`deck${deckId}`, slotIndex("bpm"), 128 - generation);
        memory.writeU32(`deck${deckId}`, slotIndex("masterDeck"), deckId);
        memory.writeU32(`deck${deckId}`, slotIndex("trackId"), numeric);
        provider.poll(clock.nowNs());
        const deck = provider.getDecks().find((d) => d.deckId === deckId);

        expect(deck?.playheadSeconds).toBeCloseTo(playheadSeconds, 6);
        expect(deck?.effectiveBpm).toBe(128 - generation);
        expect(deck?.track?.id).toBe(`rb:${numeric}`);
      },
      malformed: async () => {
        provider.ingestMalformed("helper frame crc error");
      },
      cleanup: async () => {
        await provider.stop();
      },
    });

    expect(failures).toEqual([]);
  });
});
