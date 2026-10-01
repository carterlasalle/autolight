import { connect } from "node:net";
import { describe, expect, it } from "vitest";
import {
  OS2L_PORT_MAX,
  OS2L_PORT_MIN,
  OS2L_SERVICE_TYPE,
  Os2lProvider,
  decodeOs2lText,
  formatOs2lFeedback,
  splitOs2lMessages,
} from "./os2l.js";
import { runProviderContractSuite, virtualClock } from "./contract-suite.js";
describe("OS2L framing (T-LIVE-10, os2l.org reference)", () => {
  it("advertises the documented service type and port range", () => {
    expect(OS2L_SERVICE_TYPE).toBe("_os2l._tcp");
    expect(OS2L_PORT_MIN).toBe(8010);
    expect(OS2L_PORT_MAX).toBe(8060);
  });

  it("splits newline and consecutive JSON objects, keeping the tail", () => {
    const first = splitOs2lMessages('{"evt":"beat","pos":1,"bpm":120,"change":false}\n{"evt":"beat",');
    expect(first.texts).toHaveLength(1);
    expect(first.tail.length).toBeGreaterThan(0);
    const second = splitOs2lMessages(first.tail + '"pos":2,"bpm":120,"change":false}\n');
    expect(second.texts).toHaveLength(1);
    const both = splitOs2lMessages('{"evt":"beat","pos":3,"bpm":120,"change":false}{"evt":"beat","pos":4,"bpm":120,"change":false}\n');
    expect(both.texts).toHaveLength(2);
  });

  it("decodes beat, button, command and feedback per the spec grammar", () => {
    const decoded = decodeOs2lText(
      '{"evt":"beat","pos":42,"bpm":120.0}\n' +
      '{"evt":"btn","name":"blackout","state":"on"}\n' +
      '{"evt":"cmd","id":42,"param":100.0}\n' +
      '{"evt":"feedback","name":"program1","state":"on"}\n',
    );
    expect(decoded.malformed).toEqual([]);
    expect(decoded.messages).toHaveLength(4);
    expect(decoded.messages[0]).toMatchObject({ evt: "beat", pos: 42, bpm: 120 });
    expect(formatOs2lFeedback("program1", "on")).toBe('{"evt":"feedback","name":"program1","state":"on"}');
  });

  it("rejects and counts garbage without throwing", () => {
    const provider = new Os2lProvider({ now: () => 0n });
    const before = provider.getStats().rejected;
    const result = provider.ingestText("not json\n", 0n);
    expect(result.malformed.length).toBeGreaterThan(0);
    expect(provider.getStats().rejected).toBeGreaterThan(before);
  });
});

describe("OS2L provider (T-LIVE-10)", () => {
  it("maps beat events to the master deck with beat-accurate position", () => {
    let now = 1_000_000_000_000n;
    const provider = new Os2lProvider({ now: () => now });
    provider.ingestText('{"evt":"beat","pos":42,"bpm":120.0,"change":false}\n', now);
    const decks = provider.getDecks();
    expect(decks).toHaveLength(1);
    expect(decks[0]?.effectiveBpm).toBe(120);
    expect(decks[0]?.beat).toBe(42);
    expect(decks[0]?.beatInBar).toBe(3);
    expect(decks[0]?.master).toBe(true);
    expect(decks[0]?.quality.playheadSeconds).toBe("estimated");
    expect(decks[0]?.quality.effectiveBpm).toBe("exact");
    expect(decks[0]?.fieldSources.effectiveBpm).toBe("os2l");
    now += 500_000_000n;
    provider.ingestText('{"evt":"beat","pos":43,"bpm":120.0,"change":false}\n', now);
    expect(provider.getDecks()[0]?.beat).toBe(43);
  });

  it("maps button and command messages to hints retained under raw", () => {
    const provider = new Os2lProvider({ now: () => 0n });
    provider.ingestText('{"evt":"btn","name":"loop","state":"on"}\n{"evt":"cmd","id":7,"param":50}\n', 0n);
    provider.ingestText('{"evt":"beat","pos":8,"bpm":124,"change":true}\n', 0n);
    const deck = provider.getDecks()[0];
    expect(deck?.loopRoll).toMatchObject({ active: true });
    const raw = deck?.raw as { commands: { id: number; param: number }[] };
    expect(raw.commands).toMatchObject([{ id: 7, param: 50 }]);
    provider.ingestText('{"evt":"btn","name":"hotcue 3","state":"on"}\n', 0n);
    provider.ingestText('{"evt":"beat","pos":9,"bpm":124,"change":false}\n', 0n);
    expect(provider.getDecks()[0]?.lastHotCue?.number).toBe(3);
  });

  it("accepts a scripted OS2L client over a real TCP socket", async () => {
    const clock = virtualClock();
    const provider = new Os2lProvider({ now: () => clock.nowNs(), bind: "127.0.0.1:0" });
    await provider.start();
    const port = provider.boundPort;
    expect(port).not.toBeNull();
    const seen = Promise.withResolvers<void>();
    provider.onDeckState((state) => {
      if (state.beat === 16) seen.resolve();
    });
    const { promise: closed, resolve: onClosed } = Promise.withResolvers<void>();
    const sender = connect({ host: "127.0.0.1", port: port ?? 0 }, () => {
      sender.write('{"evt":"beat","pos":16,"bpm":128,"change":false}\n');
    });
    sender.on("close", () => onClosed());
    await seen.promise;
    expect(provider.getDecks()[0]?.effectiveBpm).toBe(128);
    expect(provider.getStatus().state).toBe("live");
    const feedback: string[] = [];
    const { promise, resolve } = Promise.withResolvers<void>();
    sender.setEncoding("utf8");
    sender.on("data", (chunk: string) => {
      feedback.push(chunk);
      resolve();
    });
    provider.sendFeedback("program1", "on");
    await promise;
    expect(feedback.join("")).toContain('"feedback"');
    sender.destroy();
    await closed;
    await provider.stop();
  });

  it("passes the shared contract suite", async () => {
    const clock = virtualClock();
    const provider = new Os2lProvider({ now: () => clock.nowNs() });
    const failures = await runProviderContractSuite({
      provider,
      reportsTrackText: false,
      advance: async (ms: number) => {
        clock.advance(ms);
        provider.ingestText(`{"evt":"beat","pos":${4 + ms},"bpm":120,"change":false}\n`, clock.nowNs());
      },
      loadTrack: async (deckId: number, track: { id: string; title: string; artist: string }) => {
        void track;
        clock.advance(10);
        provider.ingestText(`{"evt":"beat","pos":${deckId},"bpm":120,"change":true}\n`, clock.nowNs());
      },
      malformed: async () => {
        provider.ingestText("garbage\n", clock.nowNs());
      },
      cleanup: async () => {},
    });
    expect(failures).toEqual([]);
  });
});
