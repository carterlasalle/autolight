import { describe, expect, it } from "vitest";
import {
  DeckGenerationMapper,
  ProviderBase,
  ScriptedProvider,
  type ProviderCapabilities,
  type ProviderDeckState,
} from "./providers.js";

class TestProvider extends ProviderBase {
  starts = 0;
  stops = 0;
  failStart = false;
  failStop = false;

  constructor() {
    super("test", "rekordbox");
  }

  protected async onStart(): Promise<void> {
    this.starts += 1;

    if (this.failStart) throw new Error("start failed");
  }

  protected async onStop(): Promise<void> {
    this.stops += 1;

    if (this.failStop) throw new Error("stop failed");
  }

  getCapabilities(): ProviderCapabilities {
    return { master: false, loop: false, pitch: false, sync: false, hotCue: false, roll: false };
  }

  getDecks(): readonly ProviderDeckState[] {
    return [];
  }
}

describe("DeckGenerationMapper", () => {
  it("bumps the generation for two distinct tracks that both lack an id", () => {
    const mapper = new DeckGenerationMapper();
    const first = mapper.update("p", { deckId: 1, track: { title: "A", artist: "X" } });
    const second = mapper.update("p", { deckId: 1, track: { title: "B", artist: "Y" } });

    expect(first.generation).toBe(1);
    expect(second.generation).toBe(2);
  });

  it("does not reuse the previous generation's beat after a track change", () => {
    const mapper = new DeckGenerationMapper();
    mapper.update("p", { deckId: 1, track: { id: "a" }, beat: 7 });
    const next = mapper.update("p", { deckId: 1, track: { id: "b" } });

    expect(next.generation).toBe(2);
    expect(next.beat).toBeNull();
  });

  it("keeps quality labels for fields a later update does not touch", () => {
    const mapper = new DeckGenerationMapper();
    mapper.update("p", { deckId: 1, track: { id: "a" }, quality: { playheadSeconds: "exact" } });
    const next = mapper.update("p", { deckId: 1, quality: { playing: "derived" } });

    expect(next.quality.playheadSeconds).toBe("exact");
    expect(next.quality.playing).toBe("derived");
  });
});

describe("ProviderBase lifecycle", () => {
  it("keeps a provider retryable after a failed start", async () => {
    const provider = new TestProvider();
    provider.failStart = true;
    await expect(provider.start()).rejects.toThrow("start failed");
    provider.failStart = false;
    await provider.start();
    expect(provider.starts).toBe(2);
  });

  it("awaits one initialization for concurrent start callers", async () => {
    const provider = new TestProvider();
    await Promise.all([provider.start(), provider.start()]);
    expect(provider.starts).toBe(1);
  });

  it("keeps a provider retryable after a failed stop", async () => {
    const provider = new TestProvider();
    provider.failStop = true;
    await provider.start();
    await expect(provider.stop()).rejects.toThrow("stop failed");
    provider.failStop = false;
    await provider.stop();
    expect(provider.stops).toBe(2);
  });

  it("reports a drained queue after synchronous dispatch", () => {
    const provider = new ScriptedProvider();
    provider.update({ deckId: 1, atNs: 1n });
    expect(provider.getStats().queueDepth).toBe(0);
  });

  it("stamps the emitted state so stored and listened copies agree", () => {
    const provider = new ScriptedProvider();
    const seen: bigint[] = [];
    provider.onDeckState((state) => seen.push(state.receivedAtNs));
    provider.update({ deckId: 1, atNs: 5000n, track: { id: "a" } });
    const second = provider.update({ deckId: 1, atNs: 5000n, track: { id: "a" } });

    expect(second.receivedAtNs).toBe(5001n);
    expect(provider.getDecks()[0]?.receivedAtNs).toBe(seen.at(-1));
  });
});
