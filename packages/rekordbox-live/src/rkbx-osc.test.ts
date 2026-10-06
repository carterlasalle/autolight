import { describe, expect, it } from "vitest";
import { decodeOscDatagram, encodeOscMessage } from "./osc.js";
import type { ProviderDeckState } from "./providers.js";
import {
  buildRkbxDatagrams,
  RkbxOscProvider,
} from "./rkbx-osc.js";
import {
  checkRkbxSetup,
  parseRkbxAddress,
  parseRkbxOscConfig,
  type RkbxSetupInput,
} from "./follow.js";

const EXPECTED_DESTINATION = "127.0.0.1:4460";

function input(over: Partial<RkbxSetupInput> = {}): RkbxSetupInput {
  return {
    configFound: true,
    config: { lines: ["osc_dest = 127.0.0.1:4460"], oscEnabled: true, destination: EXPECTED_DESTINATION },
    expectedDestination: EXPECTED_DESTINATION,
    installedRekordboxVersion: "7.2.17",
    supportedVersions: ["7.2.17", "7.2.18"],
    packetsReceived: 42,
    lastAddress: "/1/time",
    ...over,
  };
}

describe("rkbx_link address mapping (T-LIVE-03)", () => {
  it("parses deck, path and beat subdivision", () => {
    expect(parseRkbxAddress("/1/time")).toEqual({ deck: 1, path: "time", subdiv: null });
    expect(parseRkbxAddress("/master/bpm/current")).toEqual({ deck: "master", path: "bpm/current", subdiv: null });
    expect(parseRkbxAddress("/3/beat/subdiv/2")).toEqual({ deck: 3, path: "beat/subdiv/2", subdiv: 2 });
    expect(parseRkbxAddress("/deck1/time")).toBeNull();
    expect(parseRkbxAddress("/9/time")).toBeNull();
  });

  it("maps the documented addresses to deck state", () => {
    let now = 1_000n * 1_000_000_000n;
    const provider = new RkbxOscProvider({ now: () => now });
    const states: ProviderDeckState[] = [];
    provider.onDeckState((state) => states.push(state));
    const send = (address: string, value: number | string): void => {
      provider.ingestDatagram(encodeOscMessage({ address, args: [value] }), now);
    };
    send("/1/bpm/original", 128);
    send("/1/bpm/current", 134.4);
    send("/1/track/title", "Track A");
    send("/1/track/artist", "Artist A");
    send("/1/time", 0);
    now += 500n * 1_000_000n;
    send("/1/time", 0.5);
    const state = provider.getDecks()[0];
    expect(state?.playheadSeconds).toBe(0.5);
    expect(state?.effectiveBpm).toBeCloseTo(134.4, 2);
    expect(state?.playRate).toBeCloseTo(1.05, 5);
    expect(state?.playing).toBe(true);
    expect(state?.quality.playheadSeconds).toBe("exact");
    expect(state?.quality.playing).toBe("derived");
    expect(state?.track?.title).toBe("Track A");
    expect(state?.track?.artist).toBe("Artist A");
    expect(provider.drainResolutionRequests()[0]?.title).toBe("Track A");
    expect(states.length).toBeGreaterThan(0);
  });

  it("starts a new generation on a track change without leaking the old title", () => {
    let now = 1_000n * 1_000_000_000n;
    const provider = new RkbxOscProvider({ now: () => now });
    const seen: { generation: number; title: string | undefined }[] = [];
    provider.onDeckState((state) => seen.push({ generation: state.generation, title: state.track?.title }));
    provider.ingestDatagram(encodeOscMessage({ address: "/1/track/title", args: ["Track A"] }), now);
    now += 500n * 1_000_000_000n;
    provider.ingestDatagram(encodeOscMessage({ address: "/1/time", args: [10] }), now);
    now += 8n * 1_000_000n;
    provider.ingestDatagram(encodeOscMessage({ address: "/1/time", args: [10.008] }), now);
    const generationA = provider.getDecks()[0]?.generation ?? 0;
    provider.ingestDatagram(encodeOscMessage({ address: "/1/track/title", args: ["Track B"] }), now);
    const generationB = provider.getDecks()[0]?.generation ?? 0;
    expect(generationB).toBeGreaterThan(generationA);
    expect(provider.getDecks()[0]?.track?.title).toBe("Track B");
    expect(seen.filter((s) => s.generation > generationA && s.title === "Track A")).toHaveLength(0);
  });

  it("infers pause after live.rkbx.pauseHoldMs and reports a seek on a jump", () => {
    let now = 1_000n * 1_000_000_000n;
    const provider = new RkbxOscProvider({ now: () => now, playingEpsilonMs: 5, pauseHoldMs: 150, seekThresholdMs: 150 });
    const time = (seconds: number): void => {
      provider.ingestDatagram(encodeOscMessage({ address: "/1/time", args: [seconds] }), now);
    };
    time(0);
    now += 8n * 1_000_000n;
    time(0.008);
    expect(provider.getDecks()[0]?.playing).toBe(true);
    now += 8n * 1_000_000n;
    time(0.008);
    now += 200n * 1_000_000n;
    time(0.008);
    expect(provider.getDecks()[0]?.playing).toBe(false);
    expect(provider.drainSeekEvents()).toHaveLength(0);
    now += 8n * 1_000_000n;
    time(45);
    const seeks = provider.drainSeekEvents();
    expect(seeks).toHaveLength(1);
    expect(seeks[0]?.fromSeconds).toBeCloseTo(0.008, 6);
    expect(seeks[0]?.toSeconds).toBe(45);
  });

  it("assigns master to the matching deck and keeps unknown addresses", () => {
    let now = 1_000n * 1_000_000_000n;
    const provider = new RkbxOscProvider({ now: () => now });
    const send = (address: string, value: number | string): void => {
      provider.ingestDatagram(encodeOscMessage({ address, args: [value] }), now);
    };
    send("/1/time", 10);
    send("/2/time", 20);
    send("/master/time", 20);
    expect(provider.getMasterDeckId()).toBe(2);
    expect(provider.getDecks().find((d) => d.deckId === 1)?.master).toBe(false);
    expect(provider.getDecks().find((d) => d.deckId === 2)?.master).toBe(true);
    send("/1/effects/mix", 0.5);
    const raw = provider.getDecks().find((d) => d.deckId === 1)?.raw;
    expect(JSON.stringify(raw)).toContain("/1/effects/mix");
    expect(provider.getStats().rejected).toBe(0);
  });

  it("counts a malformed datagram and never throws", () => {
    const provider = new RkbxOscProvider({ now: () => 0n });
    provider.ingestDatagram(new Uint8Array([0x2f, 0x31]));
    expect(provider.getStats().rejected).toBe(1);
    expect(provider.getStatus().state).not.toBe("live");
  });
});

describe("rkbx_link timeline replay (T-LIVE-03)", () => {
  it("replays a scripted timeline with beat error below runtime.estimator.maxErrorMs", () => {
    let now = 1_000n * 1_000_000_000n;
    const provider = new RkbxOscProvider({ now: () => now });
    const datagrams = buildRkbxDatagrams({
      deck: 1,
      fromSeconds: 0,
      bpm: 128,
      hz: 120,
      durationMs: 2_000,
      steps: [
        { atMs: 0, action: "play" },
        { atMs: 500, action: "pitch", bpm: 134.4 },
        { atMs: 1_000, action: "pause" },
        { atMs: 1_200, action: "seek", seekToSeconds: 100 },
        { atMs: 1_400, action: "track", title: "Timeline Track", artist: "Suite" },
        { atMs: 1_600, action: "master" },
      ],
    });
    expect(datagrams.length).toBeGreaterThan(200);
    for (const datagram of datagrams) {
      provider.ingestDatagram(datagram.bytes, now);
      if (datagram.atMs === 500) {
        const state = provider.getDecks()[0];
        expect(state?.playing).toBe(true);
        expect(Math.abs((state?.playheadSeconds ?? 0) * 1000 - 500)).toBeLessThan(20);
      }
      now += 8_333_333n;
    }
    expect(provider.getDecks()[0]?.playRate).toBeCloseTo(1.05, 5);
    expect(provider.drainSeekEvents().some((s) => s.toSeconds === 100)).toBe(true);
    expect(provider.getMasterDeckId()).toBe(1);
    expect(provider.getStats().rejected).toBe(0);
    const last = provider.getDecks()[0];
    expect(last?.generation).toBeGreaterThan(1);
    expect(last?.master).toBe(true);
  });

  it("builds datagrams that decode back to the documented addresses", () => {
    const datagrams = buildRkbxDatagrams({ deck: 2, fromSeconds: 0, bpm: 120, hz: 60, durationMs: 100, steps: [{ atMs: 0, action: "play" }] });
    const addresses = new Set<string>();
    for (const datagram of datagrams) {
      for (const message of decodeOscDatagram(datagram.bytes).messages) addresses.add(message.address);
    }
    expect(addresses.has("/2/time")).toBe(true);
    expect(addresses.has("/2/bpm/original")).toBe(true);
  });
});

describe("rkbx_link setup verification (T-LIVE-04 logic, T-LIVE-03 DoD)", () => {
  it("reads the OSC lines of a config file tolerantly", () => {
    const probe = parseRkbxOscConfig("# rkbx_link config\nosc = true\nosc_dest = 127.0.0.1:4460\nother = 5\n");
    expect(probe.oscEnabled).toBe(true);
    expect(probe.destination).toBe(EXPECTED_DESTINATION);
    expect(probe.lines).toHaveLength(2);
  });

  it("reports each missing step with its state", () => {
    expect(checkRkbxSetup(input()).state).toBe("receiving");
    expect(checkRkbxSetup(input({ configFound: false })).state).toBe("not-installed");
    expect(checkRkbxSetup(input({ config: { lines: [], oscEnabled: false, destination: null } })).state).toBe("osc-disabled");
    expect(checkRkbxSetup(input({ config: { lines: ["osc_dest = 127.0.0.1:9999"], oscEnabled: true, destination: "127.0.0.1:9999" } })).state).toBe("wrong-destination");
    expect(checkRkbxSetup(input({ installedRekordboxVersion: "7.2.10" })).state).toBe("unsupported-version");
    expect(checkRkbxSetup(input({ packetsReceived: 0, lastAddress: null })).state).toBe("no-packets");
  });

  it("explains the unsupported version with the re-sign and sudo consequences", () => {
    const report = checkRkbxSetup(input({ installedRekordboxVersion: "7.2.10" }));
    expect(report.state).toBe("unsupported-version");
    expect(report.remedy).toContain("re-sign");
    expect(report.remedy).toContain("sudo");
    expect(report.steps.map((s) => s.id)).toEqual(["installed", "osc-enabled", "destination", "version", "receiving"]);
    expect(report.steps.find((s) => s.id === "receiving")?.ok).toBe(true);
  });
});
