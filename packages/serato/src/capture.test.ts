// T-SER-05 capture-tool proof: the loopback proxy records exactly the frames
// the peer sent, and a capture replayed through the message path lands on the
// same deck states the live client produced from the same frames.
import { afterEach, describe, expect, it } from "vitest";
import type { DeckState } from "@autolight/contracts";
import { compareSequences } from "@autolight/storage";
import { FrameReader } from "serato-connect";
import { SeratoCaptureProxy } from "./capture.js";
import { SeratoRemoteEmulator, framesForAction } from "./emulator.js";
import { SeratoRemoteProvider } from "./remote-provider.js";
import { replaySeratoFrames, splitFrames } from "./replay.js";

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  while (cleanups.length > 0) await (cleanups.pop() as () => Promise<void>)();
});

function withoutStamp(state: DeckState): Omit<DeckState, "receivedAtNs"> {
  const { receivedAtNs: _stamp, ...rest } = state;
  return rest;
}

describe("serato capture proxy (T-SER-05)", () => {
  it("records the peer's frames byte for byte and reproduces the live deck state", async () => {
    const provider = new SeratoRemoteProvider({ peerName: "autolight-capture", port: 0, host: "127.0.0.1" });
    await provider.start();
    cleanups.push(() => provider.stop());
    const remotePort = provider.setupSnapshot().advertisedPort;
    if (remotePort === null) throw new Error("provider advertised no port");

    const proxy = new SeratoCaptureProxy({ upstreamHost: "127.0.0.1", upstreamPort: remotePort });
    const { port } = await proxy.start();
    cleanups.push(() => proxy.stop());

    const emulator = new SeratoRemoteEmulator({ port, peerName: "capture emulator" });
    await emulator.connect();
    cleanups.push(() => emulator.close());
    const handshake = await emulator.handshake();
    expect(handshake.digestBytes).toBe(16);
    await emulator.playAction("two-decks", 50);
    // Wait for the invariant under test instead of a guessed delay: every byte
    // the peer sent has been forwarded and recorded, and both decks published.
    const sentBytes = (): number => Buffer.concat(emulator.capturedFrames().map((frame) => frame.bytes)).length;
    const recordedBytes = (): number => Buffer.concat(proxy.inboundFrames().map((frame) => frame.bytes)).length;
    // Both decks carry a track (the client's settled deckChange) and the
    // crossfader frame has been processed, not merely forwarded.
    const settled = (): boolean => {
      const decks = provider.getDecks();
      return decks.length >= 2
        && decks.every((deck) => deck.track !== null)
        && decks.every((deck) => Math.abs((deck.crossfader ?? -1) - 0.25) < 0.001);
    };
    const deadline = Date.now() + 3000;
    while ((recordedBytes() !== sentBytes() || !settled()) && Date.now() < deadline) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    const liveStates = provider.getDecks();

    const inbound = proxy.inboundFrames();
    expect(inbound.length).toBeGreaterThan(0);
    // Exactly what the peer sent: no re-encoding, no drops.
    expect(Buffer.concat(inbound.map((frame) => frame.bytes))).toEqual(
      Buffer.concat(emulator.capturedFrames().map((frame) => frame.bytes)),
    );
    expect(inbound.every((frame) => splitFrames(frame.bytes).length === 1)).toBe(true);
    const addresses = new FrameReader().push(Buffer.concat(inbound.map((frame) => frame.bytes))).map((message) => message.address);
    expect(addresses[0]).toBe("/StreamMgmt/Authorize/Request");
    expect(addresses).toContain("/Status/Video/Mixer/Crossfader");

    // Replay the capture through the message path on a virtual clock, grouped
    // into bursts exactly as the committed fixtures are.
    const replayedStates = replaySeratoFrames(inbound, "1x");

    const live = [...liveStates].sort((a, b) => a.deckId - b.deckId);
    const captured = [...replayedStates].sort((a, b) => a.deckId - b.deckId);
    expect(captured.map((state) => state.deckId)).toEqual(live.map((state) => state.deckId));
    const problems = compareSequences(live.map(withoutStamp), captured.map(withoutStamp), { toleranceMs: 5 });
    expect(problems, JSON.stringify(problems)).toEqual([]);
    expect(captured[0]?.track?.sourceIds.seratoPath).toBe("/music/fixture-a.mp3");
    expect(captured[1]?.track?.sourceIds.seratoPath).toBe("/music/fixture-b.mp3");
  });

  it("splits a captured stream at the protocol's own delimiter", () => {
    const frames = framesForAction("play");
    const stream = Buffer.concat(frames.map((frame) => frame.bytes));
    const split = splitFrames(stream);
    expect(split).toHaveLength(frames.length);
    expect(split.map((frame) => frame.toString("base64"))).toEqual(frames.map((frame) => frame.bytes.toString("base64")));
  });
});
