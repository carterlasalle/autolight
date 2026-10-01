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

function accessor(): MapMemoryAccessor {
  const memory = new MapMemoryAccessor();
  memory.writeU64("deck1", 0, BigInt(Math.round(12.5 * 44100)));
  memory.writeF64("deck1", 1, 128);
  memory.writeU32("deck1", 2, 1);
  memory.writeU32("deck1", 3, 555);
  return memory;
}

describe("clean-room memory reader (T-LIVE-11)", () => {
  it("parses and lints the versioned offsets file", () => {
    expect(parseOffsetsFile(offsets()).rekordboxVersion).toBe("7.2.18");
    expect(lintOffsetsFile(offsets())).toEqual([]);
    expect(lintOffsetsFile({})).not.toEqual([]);
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
    const disabled = new MemoryCleanroomProvider({ ...base, enabled: false, consentGranted: true });
    expect(disabled.capability()).toBe("MISSING");
    const noConsent = new MemoryCleanroomProvider({ ...base, enabled: true, consentGranted: false });
    expect(noConsent.capability()).toBe("CONSENT_REQUIRED");
    await noConsent.start();
    expect(noConsent.getStatus().state).toBe("unavailable");
    await noConsent.stop();
    const wrongVersion = new MemoryCleanroomProvider({ ...base, enabled: true, consentGranted: true, installedVersion: "9.9.9" });
    expect(wrongVersion.capability()).toBe("UNAVAILABLE_ON_THIS_DEVICE");
    const ready = new MemoryCleanroomProvider({ ...base, enabled: true, consentGranted: true });
    expect(ready.capability()).toBe("READY");
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
    const memory = new MapMemoryAccessor();
    memory.writeU64("region", 9, BigInt(Math.round(30 * 44100)));
    memory.writeF64("region", 4, 174);
    memory.writeU32("region", 6, 777);
    const found = scanMemoryOffsets(
      memory, ["region"], 16,
      [{ deck: 1, playheadSeconds: 30, bpm: 174, trackId: 777 }],
      44100,
    );
    expect(found.map((f) => f.field).sort()).toEqual(["bpm", "playheadSamples", "trackId"]);
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
        memory.writeU64(`deck${deckId}`, 0, BigInt(Math.round(0.5 * 44100)));
        memory.writeF64(`deck${deckId}`, 1, 128);
        memory.writeU32(`deck${deckId}`, 2, deckId);
        memory.writeU32(`deck${deckId}`, 3, numeric);
        provider.poll(clock.nowNs());
      },
      malformed: async () => {
        provider.ingestMalformed("helper frame crc error");
      },
      cleanup: async () => {},
    });
    expect(failures).toEqual([]);
  });
});
