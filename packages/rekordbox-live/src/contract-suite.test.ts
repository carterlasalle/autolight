import { describe, expect, it } from "vitest";
import {
  describeFailures,
  runProviderContractSuite,
  virtualClock,
  type ContractHarness,
  type ContractTrack,
  type ProviderContractSubject,
} from "./contract-suite.js";
import type { AxNode } from "./ax.js";
import { AxProvider } from "./ax-provider.js";
import { encodeOscMessage } from "./osc.js";
import { buildBeatPacket, buildStatusPacket } from "./prolink.js";
import { ProlinkProvider } from "./prolink-provider.js";
import { LeakyProvider, ScriptedProvider } from "./providers.js";
import { RkbxOscProvider, sendUdpDatagrams } from "./rkbx-osc.js";

function axTree(deckId: number, title: string, elapsed: string, playing: boolean): AxNode[] {
  return [
    {
      role: "AXGroup",
      position: deckId - 1,
      label: `Deck ${deckId}`,
      children: [
        { role: "AXStaticText", position: 0, label: "track title", value: title },
        { role: "AXStaticText", position: 1, label: "elapsed time", value: elapsed },
        { role: "AXButton", position: 2, label: playing ? "play" : "pause", value: "" },
      ],
    },
  ];
}

function scriptedHarness(): ContractHarness {
  return {
    name: "scripted",
    create: async (): Promise<ProviderContractSubject> => {
      const clock = virtualClock();
      const provider = new ScriptedProvider({ id: "scripted", now: () => clock.nowNs() });
      return {
        provider,
        reportsTrackText: true,
        advance: async (ms) => {
          clock.advance(ms);
          provider.update({ deckId: 1, atNs: clock.nowNs() });
        },
        loadTrack: async (deckId: number, track: ContractTrack) => {
          clock.advance(10);
          provider.update({ deckId, track, playing: true, atNs: clock.nowNs() });
        },
        malformed: async () => provider.ingestMalformed(),
        cleanup: async () => {},
      };
    },
  };
}

function rkbxHarness(): ContractHarness {
  return {
    name: "rkbx-osc",
    create: async (): Promise<ProviderContractSubject> => {
      const clock = virtualClock();
      const provider = new RkbxOscProvider({ now: () => clock.nowNs(), bind: null });
      const send = (address: string, value: number | string, atNs: bigint): void => {
        provider.ingestDatagram(encodeOscMessage({ address, args: [value] }), atNs);
      };
      return {
        provider,
        reportsTrackText: true,
        advance: async (ms) => clock.advance(ms),
        loadTrack: async (deckId: number, track: ContractTrack) => {
          clock.advance(10);
          const at = clock.nowNs();
          send(`/${deckId}/bpm/original`, 128, at);
          send(`/${deckId}/bpm/current`, 128, at);
          send(`/${deckId}/track/title`, track.title, at);
          send(`/${deckId}/time`, 0, at);
          clock.advance(20);
          send(`/${deckId}/time`, 0.25, clock.nowNs());
        },
        malformed: async () => provider.ingestDatagram(new Uint8Array([0x2f, 0x31]), clock.nowNs()),
        cleanup: async () => {},
      };
    },
  };
}

function prolinkHarness(): ContractHarness {
  return {
    name: "prolink",
    create: async (): Promise<ProviderContractSubject> => {
      const clock = virtualClock();
      const provider = new ProlinkProvider({ now: () => clock.nowNs(), bind: null });
      let trackCounter = 0;
      return {
        provider,
        reportsTrackText: false,
        advance: async (ms) => {
          clock.advance(ms);
          provider.tick(clock.nowNs());
        },
        loadTrack: async (deckId: number, track: ContractTrack) => {
          clock.advance(10);
          trackCounter += 1;
          const at = clock.nowNs();
          void track;
          provider.ingestPacket(buildBeatPacket({ deviceName: `CDJ-${deckId}`, deviceNumber: deckId, nextBeatMs: 500, bpm: 120, beatInBar: 1 }), at);
          provider.ingestPacket(buildStatusPacket({
            deviceName: `CDJ-${deckId}`, deviceNumber: deckId, trackId: 1000 + trackCounter,
            trackSlot: 1, playState: 3, master: true, sync: true, beatInBar: 1, bpm: 120,
          }), at);
        },
        malformed: async () => {
          provider.ingestPacket(new Uint8Array(60), clock.nowNs());
        },
        cleanup: async () => {},
      };
    },
  };
}

function axHarness(): ContractHarness {
  return {
    name: "ax",
    create: async (): Promise<ProviderContractSubject> => {
      const clock = virtualClock();
      const provider = new AxProvider({ now: () => clock.nowNs(), intervalMs: 0 });
      return {
        provider,
        reportsTrackText: true,
        advance: async (ms) => {
          clock.advance(ms);
        },
        loadTrack: async (deckId: number, track: ContractTrack) => {
          clock.advance(10);
          provider.ingestTree(axTree(deckId, track.title, "0:12", true), clock.nowNs());
        },
        malformed: async () => {
          provider.ingestTree([{ role: "AXUnknown", position: 0 }], clock.nowNs());
        },
        cleanup: async () => {},
      };
    },
  };
}

describe("provider contract suite (T-LIVE-01)", () => {
  for (const harness of [scriptedHarness(), rkbxHarness(), prolinkHarness(), axHarness()]) {
    it(`passes for ${harness.name}`, async () => {
      const subject = await harness.create();
      const failures = await runProviderContractSuite(subject);
      await subject.cleanup();
      expect(describeFailures(failures)).toBe("");
      expect(failures).toHaveLength(0);
    });
  }

  it("fails for a provider that leaks the previous generation (red run)", async () => {
    let loads = 0;
    const harness: ContractHarness = {
      name: "leaky",
      create: async (): Promise<ProviderContractSubject> => {
        const clock = virtualClock();
        const provider = new LeakyProvider({ id: "leaky", now: () => clock.nowNs() });
        return {
          provider,
          reportsTrackText: true,
          advance: async (ms) => {
            clock.advance(ms);
            provider.update({ deckId: 1, atNs: clock.nowNs() });
          },
          loadTrack: async (deckId: number, track: ContractTrack) => {
            loads += 1;
            clock.advance(10);
            if (loads === 2) {
              provider.leakPreviousTitle({ deckId, track, staleTitle: "Generation A", atNs: clock.nowNs() });
              return;
            }
            provider.update({ deckId, track, playing: true, atNs: clock.nowNs() });
          },
          malformed: async () => provider.ingestMalformed(),
          cleanup: async () => {},
        };
      },
    };
    const subject = await harness.create();
    const failures = await runProviderContractSuite(subject);
    expect(failures.length).toBeGreaterThan(0);
    expect(describeFailures(failures)).toMatch(/leaked from generation/);
    expect(describeFailures(failures)).not.toMatch(/track text did not follow/);
  });

  it("receives real UDP OSC datagrams through the bound socket", async () => {
    const clock = virtualClock();
    const provider = new RkbxOscProvider({ now: () => clock.nowNs(), bind: "127.0.0.1:0" });
    await provider.start();
    const port = provider.boundPort;
    expect(port).not.toBeNull();
    const received = Promise.withResolvers<void>();
    provider.onDeckState((state) => {
      if (state.playheadSeconds === 1.5) received.resolve();
    });
    const sent = await sendUdpDatagrams(
      [
        { atMs: 0, bytes: encodeOscMessage({ address: "/1/time", args: [1.5] }) },
        { atMs: 1, bytes: encodeOscMessage({ address: "/1/bpm/current", args: [128] }) },
      ],
      `127.0.0.1:${port ?? 0}`,
    );
    expect(sent).toBe(2);
    await received.promise;
    expect(provider.getDecks()[0]?.playheadSeconds).toBe(1.5);
    expect(provider.getStatus().state).toBe("live");
    await provider.stop();
  });

  it("receives real UDP PRO DJ LINK packets through the bound socket", async () => {
    const clock = virtualClock();
    const provider = new ProlinkProvider({ now: () => clock.nowNs(), bind: "127.0.0.1:0" });
    await provider.start();
    const port = provider.boundPort;
    expect(port).not.toBeNull();
    const received = Promise.withResolvers<void>();
    provider.onDeckState(() => received.resolve());
    await sendUdpDatagrams(
      [{ atMs: 0, bytes: buildBeatPacket({ deviceName: "CDJ-2", deviceNumber: 2, nextBeatMs: 468.75, bpm: 128, beatInBar: 1 }) }],
      `127.0.0.1:${port ?? 0}`,
    );
    await received.promise;
    expect(provider.getDecks()[0]?.effectiveBpm).toBe(128);
    await provider.stop();
  });
});
