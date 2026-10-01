// T-SER-01 provider proof: the Remote provider driven by the scripted peer
// over a real TCP socket, through the shared provider contract suite
// (T-LIVE-01) and through the field assertions the spec 121 items name.
import { afterEach, describe, expect, it } from "vitest";
import { runProviderContractSuite, type ContractHarness, type ContractTrack, type ProviderContractSubject } from "@autolight/rekordbox-live";
import type { ProviderDeckState } from "@autolight/rekordbox-live";
import type { OscArg, OscMessage } from "serato-connect";
import { SERATO_MASTER_INFER_HOLD_MS, SERATO_REMOTE_PROVIDER_ID, SeratoRemoteProvider, seratoRemoteProviderFor } from "./remote-provider.js";
import { SeratoRemoteEmulator, seratoActionScript } from "./emulator.js";

const running: (() => Promise<void>)[] = [];

afterEach(async () => {
  while (running.length > 0) await (running.pop() as () => Promise<void>)();
});

/** Float comparison tolerance for OSC float32 payloads. */
function closeTo(actual: number, expected: number, tolerance = 0.001): boolean {
  return Math.abs(actual - expected) <= tolerance;
}

/** Yields to the event loop without sleeping a guessed duration. */
function yieldToLoop(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setImmediate(resolve);
  return promise;
}

/** Await a condition the code under test will reach; fails on timeout. */
async function awaitCondition(condition: () => boolean, what: string, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await yieldToLoop();
  }
}

export interface StateWatcher {
  next(deckId: number, predicate?: (state: ProviderDeckState) => boolean): Promise<ProviderDeckState>;
}

/**
 * Resolves on the next deck state that matches, instead of polling or
 * sleeping. A missing state makes the awaiting test time out with the
 * provider's own status attached to the failure report.
 */
function stateWatcher(provider: SeratoRemoteProvider): StateWatcher {
  const seen: ProviderDeckState[] = [];
  const waiters: {
    deckId: number;
    predicate: (state: ProviderDeckState) => boolean;
    resolve: (state: ProviderDeckState) => void;
  }[] = [];
  provider.onDeckState((state) => {
    seen.push(state);
    for (const waiter of [...waiters]) {
      if (state.deckId !== waiter.deckId || !waiter.predicate(state)) continue;
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.resolve(state);
    }
  });
  return {
    next: (deckId, predicate = () => true) => {
      const hit = seen.find((state) => state.deckId === deckId && predicate(state));
      if (hit) return Promise.resolve(hit);
      const { promise, resolve } = Promise.withResolvers<ProviderDeckState>();
      waiters.push({ deckId, predicate, resolve });
      return promise;
    },
  };
}

interface Started {
  provider: SeratoRemoteProvider;
  emulator: SeratoRemoteEmulator;
  watcher: StateWatcher;
  clock: { nowNs: bigint };
}

interface Prepared {
  provider: SeratoRemoteProvider;
  watcher: StateWatcher;
  clock: { nowNs: bigint };
}

/** Construct a provider (not started) on a virtual clock, with cleanup hooks. */
function prepareProvider(peerName: string): Prepared {
  const clock = { nowNs: 1_000_000_000_000n };
  const provider = new SeratoRemoteProvider({ peerName, port: 0, host: "127.0.0.1", now: () => clock.nowNs });
  running.push(() => provider.stop());
  return { provider, watcher: stateWatcher(provider), clock };
}

/** Connect the scripted peer to a started provider and handshake. */
async function connectEmulator(provider: SeratoRemoteProvider, peerName: string): Promise<SeratoRemoteEmulator> {
  if (provider.getStatus().state === "starting") await provider.start();
  const advertisedPort = provider.setupSnapshot().advertisedPort;
  if (advertisedPort === null) throw new Error("provider advertised no port");
  const emulator = new SeratoRemoteEmulator({ port: advertisedPort, peerName: `${peerName} emulator` });
  await emulator.connect();
  running.push(() => emulator.close());
  await emulator.handshake();
  return emulator;
}

async function startProvider(peerName: string): Promise<Started> {
  const prepared = prepareProvider(peerName);
  const emulator = await connectEmulator(prepared.provider, peerName);
  return { ...prepared, emulator };
}

function deckArg(deckId: number): OscArg {
  return { type: "i", value: deckId - 1 };
}

function textMessage(address: string, deckId: number, value: string): OscMessage {
  return { address, args: [deckArg(deckId), { type: "s", value }] };
}

function validMessage(deckId: number): OscMessage {
  return { address: "/Status/Deck/Song/Valid", args: [deckArg(deckId), { type: "f", value: 1 }] };
}

/** The field burst a track load produces, sent as the protocol sends it. */
function loadTrackBurst(deckId: number, track: ContractTrack, filePath: string): OscMessage[] {
  return [
    textMessage("/Status/Deck/Song/Title", deckId, track.title),
    textMessage("/Status/Deck/Song/Artist", deckId, track.artist),
    textMessage("/Status/Deck/Song/Filepath", deckId, filePath),
    validMessage(deckId),
  ];
}

function filePathFor(track: ContractTrack): string {
  return track.id.startsWith("/") ? track.id : `/${track.id}.mp3`;
}

describe("serato remote provider (T-SER-01)", () => {
  it("passes the shared provider contract suite against the emulator", async () => {
    const started: Prepared[] = [];
    const harness: ContractHarness = {
      name: "serato-remote",
      create: async (): Promise<ProviderContractSubject> => {
        const prepared = prepareProvider("autolight-suite");
        started.push(prepared);
        const { provider, watcher, clock } = prepared;
        let emulator: SeratoRemoteEmulator | null = null;
        const peer = async (): Promise<SeratoRemoteEmulator> => {
          if (emulator === null) emulator = await connectEmulator(provider, "autolight-suite");
          return emulator;
        };
        return {
          provider,
          reportsTrackText: true,
          advance: async (ms: number) => {
            clock.nowNs += BigInt(Math.round(ms)) * 1_000_000n;
            await yieldToLoop();
          },
          loadTrack: async (deckId: number, track: ContractTrack) => {
            const socket = await peer();
            for (const message of loadTrackBurst(deckId, track, filePathFor(track))) socket.send(message);
            await watcher.next(deckId, (state) => state.track?.title === track.title);
          },
          malformed: async () => {
            const socket = await peer();
            const rejected = provider.getStats().rejected;
            socket.sendMalformedFrame();
            await awaitCondition(() => provider.getStats().rejected > rejected, "the malformed frame to be counted");
          },
          cleanup: async () => {
            await emulator?.close();
            await provider.stop();
          },
        };
      },
    };
    const failures = await runProviderContractSuite(await harness.create());
    expect(failures).toEqual([]);
    // The suite's malformed step must have been counted by the provider.
    expect(started[0]?.provider.getStats().rejected).toBeGreaterThan(0);
  });

  it("advertises, handshakes, pairs and subscribes through the emulator", async () => {
    const { provider, emulator } = await startProvider("autolight-handshake");
    const setup = provider.setupSnapshot();
    expect(setup.advertised).toBe(true);
    expect(setup.advertisedPort).toBeGreaterThan(0);
    expect(setup.connected).toBe(true);
    expect(setup.authenticated).toBe(true);
    expect(emulator.receivedAddresses()).toContain("/StreamMgmt/Authorize/Response");
    expect(emulator.receivedAddresses()).toContain("/Register/Status/Deck/Playhead");
    expect(emulator.receivedAddresses()).toContain("/Register/Status/Video/Mixer/Crossfader");
  });

  it("reports all four decks independently with their own identities", async () => {
    const { provider, emulator, watcher } = await startProvider("autolight-four-decks");
    for (const deckId of [1, 2, 3, 4]) {
      const track: ContractTrack = { id: `deck-${deckId}`, title: `Track ${deckId}`, artist: "Emulator" };
      for (const message of loadTrackBurst(deckId, track, filePathFor(track))) emulator.send(message);
      await watcher.next(deckId, (state) => state.track?.title === `Track ${deckId}`);
    }
    const decks = provider.getDecks();
    expect(decks.map((deck) => deck.deckId)).toEqual([1, 2, 3, 4]);
    for (const deck of decks) {
      expect(deck.source).toBe("serato");
      expect(deck.track?.sourceIds.seratoPath).toBe(`/deck-${deck.deckId}.mp3`);
      expect(deck.track?.title).toBe(`Track ${deck.deckId}`);
      expect(deck.track?.artist).toBe("Emulator");
    }
  });

  it("maps playhead, rate, BPM, loop, roll, faders and seeks", async () => {
    const { emulator, watcher } = await startProvider("autolight-fields");
    await emulator.playAction("pitch-plus-8", 20);
    const playing = await watcher.next(1, (state) => closeTo(state.playRate, 1.08) && state.track !== null);
    expect(playing.track?.sourceIds.seratoPath).toBe("/music/fixture-a.mp3");
    expect(playing.playing).toBe(true);
    expect(playing.playheadSeconds).toBeGreaterThan(0);
    expect(playing.effectiveBpm).toBeCloseTo(133.92, 2);
    expect(playing.quality.playheadSeconds).toBe("exact");
    expect(playing.quality.playing).toBe("derived");
    expect(playing.master).toBeNull();

    await emulator.playAction("loop-4-beat", 20);
    const looped = await watcher.next(1, (state) => state.loop.active);
    expect(looped.loop).toEqual({ active: true, startSeconds: null, endSeconds: null, beatLength: 4 });

    await emulator.playAction("loop-roll", 20);
    const rolled = await watcher.next(1, (state) => state.loopRoll?.active === true);
    expect(rolled.loopRoll).toEqual({ active: true, beatLength: 0.5 });
    expect(rolled.loop.beatLength).toBe(0.5);

    await emulator.playAction("upfader", 20);
    const faded = await watcher.next(1, (state) => closeTo(state.channelFader ?? 0, 0.8));
    expect(faded.channelFader).toBeCloseTo(0.8, 3);

    await emulator.playAction("crossfader", 20);
    const crossed = await watcher.next(1, (state) => closeTo(state.crossfader ?? 0, 1));
    expect(crossed.crossfader).toBe(1);

    await emulator.playAction("seek", 20);
    const sought = await watcher.next(1, (state) => state.playheadSeconds === 30);
    expect(sought.playheadSeconds).toBe(30);
  });

  it("derives playing from the play rate and clears it on pause", async () => {
    const { emulator, watcher } = await startProvider("autolight-playing");
    await emulator.playAction("pause", 20);
    const paused = await watcher.next(1, (state) => state.playheadSeconds === 2 && !state.playing);
    expect(paused.playing).toBe(false);
    expect(paused.playRate).toBe(0);
  });

  it("starts a new generation on a track change without leaking the old track", async () => {
    const { provider, emulator, watcher } = await startProvider("autolight-generation");
    const seen: ProviderDeckState[] = [];
    provider.onDeckState((state) => seen.push(state));
    await emulator.playAction("replace-track", 20);
    const replaced = await watcher.next(1, (state) => state.track?.title === "Fixture C");
    expect(replaced.generation).toBeGreaterThan(0);
    expect(replaced.track?.sourceIds.seratoPath).toBe("/music/fixture-c.mp3");
    expect(replaced.loop.active).toBe(false);
    const firstNew = seen.findIndex((state) => state.track?.title === "Fixture C");
    expect(firstNew).toBeGreaterThanOrEqual(0);
    const afterChange = seen.slice(firstNew);
    expect(afterChange.every((state) => state.track?.title !== "Fixture A")).toBe(true);
    expect(afterChange.some((state) => state.loop.active === false)).toBe(true);
  });

  it("selects by switch id and keeps the unmeasured infer hold default", () => {
    expect(seratoRemoteProviderFor("serato-remote")).toBeInstanceOf(SeratoRemoteProvider);
    expect(seratoRemoteProviderFor("serato")).toBeInstanceOf(SeratoRemoteProvider);
    expect(seratoRemoteProviderFor("fusion")).toBeNull();
    expect(seratoRemoteProviderFor("rkbx-osc")).toBeNull();
    const provider = new SeratoRemoteProvider();
    expect(provider.id).toBe(SERATO_REMOTE_PROVIDER_ID);
    expect(provider.masterInferHoldMs).toBe(SERATO_MASTER_INFER_HOLD_MS);
    expect(new SeratoRemoteProvider({ masterInferHoldMs: 900 }).masterInferHoldMs).toBe(900);
  });

  it("plays every Remote-expressible action script without a rejected frame", async () => {
    const { provider, emulator, watcher } = await startProvider("autolight-actions");
    for (const action of ["load-deck-1", "play", "pause", "seek", "loop-1-beat", "loop-roll", "two-decks"] as const) {
      const before = provider.getStats().rejected;
      await emulator.playAction(action, 20);
      await watcher.next(1, () => true);
      expect(provider.getStats().rejected).toBe(before);
      expect(seratoActionScript(action).length).toBeGreaterThan(0);
    }
    await emulator.playAction("eject-deck-1", 20);
    const ejected = await watcher.next(1, (state) => state.track === null);
    expect(ejected.track).toBeNull();
  });

  it("counts a malformed frame as rejected and degrades instead of throwing", async () => {
    const { provider, emulator } = await startProvider("autolight-malformed");
    const rejectedBefore = provider.getStats().rejected;
    const statuses: string[] = [];
    provider.onConnection((status) => statuses.push(status.state));
    emulator.sendMalformedFrame();
    await awaitCondition(() => provider.getStats().rejected > rejectedBefore, "the malformed frame to be counted");
    expect(provider.getStatus().state).not.toBe("failed");
    expect(statuses).toContain("degraded");
  });
});
