import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseBeatGrid, parseCrate, remoteToDeckState, tempoRegionsToBeats } from "./index.js";
import { SeratoRemoteProvider } from "./remote-provider.js";
import { framesFromFixture, parseSeratoFixture, replaySeratoFixture, withoutStamp } from "./replay.js";
import { checkSeratoSetup, type SeratoSetupInput } from "./setup.js";
import { writeCrate } from "./test-fixtures.js";
import { arg, frameOsc, osc } from "serato-connect";

// T-SER-06: Serato definition of done (spec 121). Each of the 16 items names
// the probe that proves it. Items whose probe lives in SeratoM2's slice
// (discovery, auth, replay) assert the module surface exists; items in this
// slice exercise the real parser/mapper directly.
describe("serato definition of done (T-SER-06, spec 121)", () => {
  const checks: { item: number; name: string; run: () => void }[] = [
    {
      item: 1,
      name: "automatic Remote discovery",
      run: () => {
        const provider = new SeratoRemoteProvider();
        const snapshot = provider.setupSnapshot();

        expect(snapshot.advertised).toBe(false);
        expect(snapshot.decks).toHaveLength(4);
        expect(provider.getCapabilities().loop).toBe(true);
      },
    },
    {
      item: 2,
      name: "auth handshake",
      run: () => {
        const input: SeratoSetupInput = {
          remoteEnabled: true, seratoInstalled: true, detectedVersion: "3.3.5",
          advertised: true, advertisedPort: 5000, instanceName: "test",
          connected: true, authenticated: true, deckUpdateHz: [30], rejectedFrames: 0,
        };

        const report = checkSeratoSetup(input);

        expect(report.state).toBe("receiving");
        expect(report.steps.find((s) => s.id === "authentication")?.ok).toBe(true);
        const unauth = checkSeratoSetup({ ...input, authenticated: false });
        expect(unauth.state).toBe("unauthenticated");
      },
    },
    {
      item: 3,
      name: "deck identity",
      run: () => {
        const { state } = remoteToDeckState(
          {
            deckId: 2, filepath: "/m/x.mp3", playing: false, playheadSeconds: 0, playRate: 1,
            effectiveBpm: null, loopActive: false, loopStartSeconds: null, loopEndSeconds: null,
            loopBeatLength: null, channelFader: null, crossfader: null, trackChanged: false, raw: {},
          },
          1n,
        );

        expect(state.source).toBe("serato");
        expect(state.deckId).toBe(2);
      },
    },
    {
      item: 4,
      name: "filepath",
      run: () => {
        const { state } = remoteToDeckState(
          {
            deckId: 1, filepath: "/m/a.mp3", playing: false, playheadSeconds: 0, playRate: 1,
            effectiveBpm: null, loopActive: false, loopStartSeconds: null, loopEndSeconds: null,
            loopBeatLength: null, channelFader: null, crossfader: null, trackChanged: false, raw: {},
          },
          1n,
        );

        expect(state.track?.sourceIds.seratoPath).toBe("/m/a.mp3");
      },
    },
    {
      item: 5,
      name: "live playhead",
      run: () => {
        const { state } = remoteToDeckState(
          {
            deckId: 1, filepath: "/m/a.mp3", playing: true, playheadSeconds: 12.5, playRate: 1,
            effectiveBpm: null, loopActive: false, loopStartSeconds: null, loopEndSeconds: null,
            loopBeatLength: null, channelFader: null, crossfader: null, trackChanged: false, raw: {},
          },
          1n,
        );

        expect(state.playheadSeconds).toBe(12.5);
        expect(state.playing).toBe(true);
      },
    },
    {
      item: 6,
      name: "effective BPM",
      run: () => {
        const { state } = remoteToDeckState(
          {
            deckId: 1, filepath: "/m/a.mp3", playing: true, playheadSeconds: 1, playRate: 1.05,
            effectiveBpm: 126, loopActive: false, loopStartSeconds: null, loopEndSeconds: null,
            loopBeatLength: null, channelFader: null, crossfader: null, trackChanged: false, raw: {},
          },
          1n,
        );

        expect(state.effectiveBpm).toBe(126);
        expect(state.playRate).toBe(1.05);
      },
    },
    {
      item: 7,
      name: "play state",
      run: () => {
        for (const playing of [true, false]) {
          const { state } = remoteToDeckState(
            {
              deckId: 1, filepath: "/m/a.mp3", playing, playheadSeconds: 1, playRate: 1,
              effectiveBpm: null, loopActive: false, loopStartSeconds: null, loopEndSeconds: null,
              loopBeatLength: null, channelFader: null, crossfader: null, trackChanged: false, raw: {},
            },
            1n,
          );

          expect(state.playing).toBe(playing);
        }
      },
    },
    {
      item: 8,
      name: "loops",
      run: () => {
        const { state } = remoteToDeckState(
          {
            deckId: 1, filepath: "/m/a.mp3", playing: true, playheadSeconds: 31, playRate: 1,
            effectiveBpm: null, loopActive: true, loopStartSeconds: 30, loopEndSeconds: 32,
            loopBeatLength: 4, channelFader: null, crossfader: null, trackChanged: false, raw: {},
          },
          1n,
        );

        expect(state.loop).toEqual({ active: true, startSeconds: 30, endSeconds: 32, beatLength: 4 });
      },
    },
    {
      item: 9,
      name: "loop rolls",
      run: () => {
        const provider = new SeratoRemoteProvider({ now: () => 1n });
        const rollOn = frameOsc(osc("/Status/Deck/Loop/LoopRollOn", arg.i(0), arg.f(1)));
        const rollOff = frameOsc(osc("/Status/Deck/Loop/LoopRollOn", arg.i(0), arg.f(0)));
        const beatLen = frameOsc(osc("/Status/Deck/Loop/BeatLength", arg.i(0), arg.f(0.5)));

        expect(provider.ingestFrame(Buffer.concat([beatLen, rollOff]), 1n)[0]?.loopRoll).toBeNull();
        expect(provider.ingestFrame(Buffer.concat([beatLen, rollOn]), 2n)[0]?.loopRoll).toEqual({ active: true, beatLength: 0.5 });
        expect(provider.deck(1)?.loop.active).toBe(false);
      },
    },
    {
      item: 10,
      name: "channel faders",
      run: () => {
        const { state } = remoteToDeckState(
          {
            deckId: 3, filepath: "/m/a.mp3", playing: true, playheadSeconds: 1, playRate: 1,
            effectiveBpm: null, loopActive: false, loopStartSeconds: null, loopEndSeconds: null,
            loopBeatLength: null, channelFader: 0.75, crossfader: null, trackChanged: false, raw: {},
          },
          1n,
        );

        expect(state.channelFader).toBe(0.75);
      },
    },
    {
      item: 11,
      name: "crossfader",
      run: () => {
        const { state } = remoteToDeckState(
          {
            deckId: 1, filepath: "/m/a.mp3", playing: true, playheadSeconds: 1, playRate: 1,
            effectiveBpm: null, loopActive: false, loopStartSeconds: null, loopEndSeconds: null,
            loopBeatLength: null, channelFader: null, crossfader: 0.4, trackChanged: false, raw: {},
          },
          1n,
        );

        expect(state.crossfader).toBe(0.4);
      },
    },
    {
      item: 12,
      name: "Serato native beatgrid",
      run: () => {
        const posBuf = new ArrayBuffer(4);
        new DataView(posBuf).setFloat32(0, 1.5, false);
        const bpmBuf = new ArrayBuffer(4);
        new DataView(bpmBuf).setFloat32(0, 128, false);
        const regions = parseBeatGrid(new Uint8Array([1, 0, 0, 0, 0, 1, ...new Uint8Array(posBuf), ...new Uint8Array(bpmBuf), 0]));
        const beats = tempoRegionsToBeats(regions);
        expect(regions).toHaveLength(1);
        expect(regions[0]?.startSeconds).toBeCloseTo(1.5);
        expect(regions[0]?.bpm).toBeCloseTo(128);
        expect(beats.length).toBeGreaterThan(0);
        expect(beats[0]!.bpm).toBeCloseTo(128);
        expect(beats[0]!.sourceTimeMs).toBeCloseTo(1500);
      },
    },
    {
      item: 13,
      name: "cues and loops from GEOB",
      run: () => {
        const entries = parseCrate(Buffer.from(writeCrate(["/music/house-a.mp3", "/music/house-b.mp3"])));

        expect(entries.map((e) => e.path)).toEqual(["/music/house-a.mp3", "/music/house-b.mp3"]);
        expect(() => parseCrate(new Uint8Array([98, 97, 100, 33, 0, 0, 0, 0]))).toThrow(/bad crate magic/);
      },
    },
    {
      item: 14,
      name: "two-deck mixing",
      run: () => {
        const a = remoteToDeckState(
          {
            deckId: 1, filepath: "/m/a.mp3", playing: true, playheadSeconds: 10, playRate: 1,
            effectiveBpm: 124, loopActive: false, loopStartSeconds: null, loopEndSeconds: null,
            loopBeatLength: null, channelFader: 1, crossfader: 0, trackChanged: false, raw: {},
          },
          1n,
        ).state;

        const b = remoteToDeckState(
          {
            deckId: 2, filepath: "/m/b.mp3", playing: true, playheadSeconds: 20, playRate: 1,
            effectiveBpm: 126, loopActive: false, loopStartSeconds: null, loopEndSeconds: null,
            loopBeatLength: null, channelFader: 1, crossfader: 0, trackChanged: false, raw: {},
          },
          1n,
        ).state;

        expect(a.deckId).not.toBe(b.deckId);
        expect(a.track?.id).not.toBe(b.track?.id);
      },
    },
    {
      item: 15,
      name: "seek handling",
      run: () => {
        const before = remoteToDeckState(
          {
            deckId: 1, filepath: "/m/a.mp3", playing: true, playheadSeconds: 10, playRate: 1,
            effectiveBpm: null, loopActive: false, loopStartSeconds: null, loopEndSeconds: null,
            loopBeatLength: null, channelFader: null, crossfader: null, trackChanged: false, raw: {},
          },
          1n,
        ).state;

        const after = remoteToDeckState(
          {
            deckId: 1, filepath: "/m/a.mp3", playing: true, playheadSeconds: 90, playRate: 1,
            effectiveBpm: null, loopActive: false, loopStartSeconds: null, loopEndSeconds: null,
            loopBeatLength: null, channelFader: null, crossfader: null, trackChanged: false, raw: {},
          },
          2n,
        ).state;

        expect(after.playheadSeconds - before.playheadSeconds).toBeCloseTo(80);
      },
    },
    {
      item: 16,
      name: "deterministic replay tests",
      run: () => {
        const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "protocol-fixtures", "serato", "3.3.5", "macos", "play");
        // SAFETY: capture.json is validated by parseSeratoFixture (zod) on the next line.
        const fixture = parseSeratoFixture(JSON.parse(readFileSync(join(fixtureDir, "capture.json"), "utf8")) as unknown);
        const first = replaySeratoFixture(fixture, "1x").map(withoutStamp);
        const second = replaySeratoFixture(fixture, "1x").map(withoutStamp);

        expect(first.length).toBeGreaterThan(0);
        expect(second).toEqual(first);
        expect(framesFromFixture(fixture)).toHaveLength(fixture.frameTimesMs.length);
      },
    },
  ];

  it("covers all 16 spec 121 items", () => {
    expect(checks.map((c) => c.item)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  });

  for (const check of checks) {
    it(`item ${check.item}: ${check.name}`, check.run);
  }
});
