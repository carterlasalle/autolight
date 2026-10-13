import { describe, expect, it } from "vitest";
 import { Flx4Decoder, type Flx4Event } from "./map.js";
import {
  type CompositeControllerInput,
  Flx4Feed,
  confirmControllerAudible,
  deriveExpressiveHints,
  driveCompositeFromFeed,
  feedEventFromDecoded,
  type Flx4FeedEvent,
  type Flx4ModelLike,
  type Flx4ServiceLike,
  mapHintToMixer,
  subscribeServiceToComposite,
} from "./integration.js";
import type { Flx4Signal } from "./signals.js";

function at(ms: number): bigint {
  return BigInt(Math.round(ms)) * 1_000_000n;
}

function deckEvent(
  deck: 1 | 2,
  control: Flx4FeedEvent["control"],
  value: number,
  ms: number,
  pad: number | null = null,
): Flx4FeedEvent {
  return { deck, control, value, pad, atNs: at(ms) };
}

describe("flx4 composite integration (T-FLX-06)", () => {
  it("converts deck-aware decoder events with channel-derived decks", () => {
    const decoder = new Flx4Decoder();

    // Deck 1 PLAY on channel 1, deck 2 PLAY on channel 2: same Data 1.
    const d1 = feedEventFromDecoded(
      decoder.decode({ status: 0x90, data1: 0x0b, data2: 0x7f, receivedAtNs: at(0) }),
    );

    const d2 = feedEventFromDecoded(
      decoder.decode({ status: 0x91, data1: 0x0b, data2: 0x7f, receivedAtNs: at(10) }),
    );

    expect(d1).toMatchObject({ deck: 1, control: "play", value: 1 });
    expect(d2).toMatchObject({ deck: 2, control: "play", value: 1 });

    // 14-bit tempo MSB+LSB on deck 2 reconstructs monotonically.
    const t1 = feedEventFromDecoded(
      decoder.decode({ status: 0xb1, data1: 0x00, data2: 0x40, receivedAtNs: at(20) }),
    );

    expect(t1).toBeNull(); // MSB alone is incomplete

    const t2 = feedEventFromDecoded(
      decoder.decode({ status: 0xb1, data1: 0x20, data2: 0x00, receivedAtNs: at(21) }),
    );

    expect(t2).toMatchObject({ deck: 2, control: "tempo" });
    expect(t2?.value ?? 0).toBeCloseTo(0x2000 / 16383, 4);
  });

  it("feeds a virtual port session into the composite provider", () => {
    const decoder = new Flx4Decoder();
    const feed = new Flx4Feed();
    const seen: { deck: number; control: string; value: number }[] = [];

    const composite = {
      ingestControllerEvent: (event: { deck: 1 | 2 | 0; control: string; value: number; pad: number | null; atNs: bigint }) => {
        seen.push({ deck: event.deck, control: event.control, value: event.value });
      },
    };

    // Recorded session on real bytes: LOAD deck 1, PLAY, tempo pair, channel
    // fader pair, crossfader pair. Each 14-bit MSB arrives incomplete and is
    // kept as unknown until its LSB completes the pair; the completed LSB
    // carries the full value.
    const session: [number, number, number][] = [
      [0x96, 0x46, 0x7f],
      [0x90, 0x0b, 0x7f],
      [0xb0, 0x00, 0x48],
      [0xb0, 0x20, 0x10],
      [0xb0, 0x13, 0x60],
      [0xb0, 0x33, 0x08],
      [0xb6, 0x1f, 0x30],
      [0xb6, 0x3f, 0x08],
    ];

    let ms = 0;

    for (const [status, data1, data2] of session) {
      feed.ingestDecoded(decoder.decode({ status, data1, data2, receivedAtNs: at(ms) }));
      ms += 10;
    }

    expect(feed.unknownEvents()).toHaveLength(3);
    expect(feed.unknownEvents().map((e) => [...e.raw])).toEqual([
      [0xb0, 0x00, 0x48],
      [0xb0, 0x13, 0x60],
      [0xb6, 0x1f, 0x30],
    ]);
    const drained = driveCompositeFromFeed(feed, composite);
    expect(drained).toBe(5);
    expect(seen.map((e) => `${e.deck}:${e.control}`)).toEqual([
      "1:load",
      "1:play",
      "1:tempo",
      "1:channel-fader",
      "0:crossfader",
    ]);
    expect(seen.map((e) => Math.round(e.value * 1000) / 1000)).toEqual([1, 1, 0.564, 0.751, 0.376]);
  });

  it("keeps unknown messages with raw bytes instead of dropping them", () => {
    const feed = new Flx4Feed();
    const unknown = feed.ingestDecoded({ type: "unknown", raw: [0xb0, 0x77, 0x01], receivedAtNs: at(0) });
    expect(unknown).toBeNull();
    expect(feed.unknownEvents()).toHaveLength(1);
    expect(feed.unknownEvents()[0]).toMatchObject({ type: "unknown", raw: [0xb0, 0x77, 0x01], receivedAtNs: at(0) });
  });

  it("bounds the queue with a drop counter", () => {
    const feed = new Flx4Feed({ capacity: 2 });
    feed.push(deckEvent(1, "tempo", 0.1, 0));
    feed.push(deckEvent(1, "tempo", 0.2, 10));
    feed.push(deckEvent(2, "tempo", 0.3, 20));
    // Latest-wins per deck+control keeps 2 buckets; nothing dropped yet.
    expect(feed.depth()).toBe(2);
    feed.push(deckEvent(1, "channel-fader", 0.9, 30));
    feed.push(deckEvent(2, "channel-fader", 0.8, 40));
    expect(feed.droppedCount()).toBe(2);
    expect(feed.depth()).toBe(2);
    const drained = feed.drain();
    expect(drained.map((e) => [e.deck, e.control, e.value])).toEqual([
      [1, "channel-fader", 0.9],
      [2, "channel-fader", 0.8],
    ]);
  });

  it("wires service, model, deriver and composite in one subscription", () => {
    const decoder = new Flx4Decoder();
    const feed = new Flx4Feed();
    const compositeSeen: string[] = [];

    const composite: CompositeControllerInput = {
      ingestControllerEvent: (event: { deck: 1 | 2 | 0; control: string; value: number; pad: number | null; atNs: bigint }) => {
        compositeSeen.push(`${event.deck}:${event.control}`);
      },
    };

    const applied: string[] = [];
    const model: Flx4ModelLike = { apply: (event) => applied.push(event.type) };
    const listeners = new Set<(event: Flx4Event) => void>();

    const service: Flx4ServiceLike = { onEvent: (listener) => {
      listeners.add(listener);

      return () => { listeners.delete(listener); };
    } };

    const wiring = subscribeServiceToComposite(
      service,
      model,
      (event): Flx4Signal[] => [{
        kind: "fader", deck: 1, value: 0.5, atNs: event.receivedAtNs, quality: "observed", source: "controller",
      }],
      composite,
      feed,
    );

    const emit = (event: Flx4Event): void => {
      for (const listener of listeners) listener(event);
    };

    emit(decoder.decode({ status: 0x90, data1: 0x0b, data2: 0x7f, receivedAtNs: at(0) }));
    expect(applied).toEqual(["control"]);
    expect(wiring.signals()).toMatchObject([{ kind: "fader", deck: 1, value: 0.5, quality: "observed", source: "controller" }]);
    expect(wiring.consumed()).toBe(1);
    expect(compositeSeen).toEqual(["1:play"]);
    wiring.stop();
    expect(listeners.size).toBe(0);
    emit(decoder.decode({ status: 0x90, data1: 0x0b, data2: 0x7f, receivedAtNs: at(10) }));
    expect(applied).toHaveLength(1);
    expect(compositeSeen).toHaveLength(1);
  });

  it("confirms audibility only when both sources agree", () => {
    expect(confirmControllerAudible(0.8, 0.5)).toBe(true);
    expect(confirmControllerAudible(0, 0.5)).toBe(false);
    // Documented fail-open: a missing controller fader defers to the DJ
    // weight so hints keep flowing without hardware; this is the null branch
    // of the contract above, not a second source agreeing.
    expect(confirmControllerAudible(null, 0.5)).toBe(true);
    expect(confirmControllerAudible(null, 0)).toBe(false);
  });
});

describe("expressive hints (T-FLX-05)", () => {
  const audibleCtx = (audibleDecks: (1 | 2)[] = [1, 2]) => ({
    audible: (deck: 1 | 2): boolean => audibleDecks.includes(deck),
    impactAllowed: (): boolean => true,
  });

  it("detects a large filter sweep and maps it to density", () => {
    const history = [deckEvent(1, "filter", 0.1, 0), deckEvent(1, "filter", 0.3, 500)];
    const hints = deriveExpressiveHints([deckEvent(1, "filter", 0.8, 1000)], history);
    expect(hints).toHaveLength(1);
    expect(hints[0]).toMatchObject({ kind: "filter-sweep", channel: 1, detail: "open" });
    const { mapped, used } = mapHintToMixer(hints[0]!, audibleCtx());
    expect(mapped).toMatchObject({ action: "reduce-density" });
    expect(used.used).toBe(true);
  });

  it("ignores a small filter move", () => {
    const hints = deriveExpressiveHints(
      [deckEvent(1, "filter", 0.55, 1000)],
      [deckEvent(1, "filter", 0.5, 0)],
    );

    expect(hints).toHaveLength(0);
  });

  it("advances introduction stages on a rising incoming fader", () => {
    const hints = deriveExpressiveHints(
      [deckEvent(2, "channel-fader", 0.8, 1000)],
      [deckEvent(2, "channel-fader", 0.1, 0)],
    );

    expect(hints).toHaveLength(1);
    const { mapped } = mapHintToMixer(hints[0]!, audibleCtx([2]));
    expect(mapped).toEqual({ action: "advance-intro", stage: "impacts" });
  });

  it("marks loop shrink cadence and at most one impact per restraint window", () => {
    const shrink = deriveExpressiveHints([deckEvent(1, "loop-halve", 1, 0)], []);
    expect(shrink[0]?.detail).toBe("shrink");
    const { mapped: cadence } = mapHintToMixer(shrink[0]!, audibleCtx());
    expect(cadence).toMatchObject({ action: "raise-cadence" });
    const first = deriveExpressiveHints([deckEvent(1, "loop-exit", 1, 1000)], [])[0]!;
    const second = deriveExpressiveHints([deckEvent(1, "loop-exit", 1, 2000)], [])[0]!;
    const r1 = mapHintToMixer(first, { ...audibleCtx(), lastImpactAtNs: null });
    expect(r1.mapped).toMatchObject({ action: "impact-on-next-beat" });
    expect(r1.used.used).toBe(true);
    const r2 = mapHintToMixer(second, { ...audibleCtx(), lastImpactAtNs: first.atNs });
    expect(r2.mapped).toEqual({ action: "ignore", reason: "impact restraint window" });
    expect(r2.used.used).toBe(false);
  });

  it("arms bass re-entry on kill and marks it on return", () => {
    const kill = deriveExpressiveHints([deckEvent(1, "eq-low", 0, 0)], [])[0]!;
    const killMapped = mapHintToMixer(kill, audibleCtx());
    expect(killMapped.mapped).toEqual({ action: "ignore", reason: "kill arms re-entry" });
    expect(killMapped.used.used).toBe(false);

    const reentry = deriveExpressiveHints(
      [deckEvent(1, "eq-low", 0.8, 5000)],
      [deckEvent(1, "eq-low", 0, 0)],
    )[0]!;

    expect(reentry.detail).toBe("re-entry");
    const { mapped, used } = mapHintToMixer(reentry, audibleCtx());
    expect(mapped).toMatchObject({ action: "mark-bass-reentry" });
    expect(used.used).toBe(true);
  });

  it("emphasises spatial subdivision on pad roll and ignores silent decks", () => {
    const roll = deriveExpressiveHints([deckEvent(1, "pad-roll", 1, 0, 3)], [])[0]!;
    const { mapped } = mapHintToMixer(roll, audibleCtx());
    expect(mapped).toMatchObject({ action: "subdivide-spatial" });
    const ignored = mapHintToMixer(roll, audibleCtx([2]));
    expect(ignored.mapped).toEqual({ action: "ignore", reason: "deck not audible" });
    expect(ignored.used.used).toBe(false);
  });
});
