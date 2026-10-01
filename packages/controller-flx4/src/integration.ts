// T-FLX-06 composite provider integration (F-LIVE-06 MIDI part).
//
// The in-process feed from the FLX4 decode/state/signal layers (T-FLX-01 to
// T-FLX-04) into the T-LIVE-07 composite provider over a bounded subscription.
// The deck-aware map (T-FLX-02) owns byte meanings; this file owns the seam:
// - `Flx4FeedEvent`: the minimal structural shape this feed consumes,
//   converted from `Flx4Event` by `feedEventFromDecoded`. Deck separation
//   comes from the MIDI channel via the map, not from value ranges.
// - `Flx4Feed`: bounded latest-wins queue (S26). Slow consumers drop, with a
//   drop counter; the composite run in the contract suite uses this queue.
// - `driveCompositeFromFeed`: drains the feed into the composite provider.
//   Unknown raw messages are kept and counted, never dropped silently, and
//   visible to the DJ Event Inspector via `unknownEvents()`.
// - `subscribeServiceToComposite`: the production wiring: service events flow
//   into the state model, signals derive per event, transport edges and
//   faders reach the composite provider, scratch traces go to the runtime.
// - `ExpressiveHint` (T-FLX-05): controller activity as strength/duration
//   events, never direct lighting (spec 11 "no random reaction"). The mixer
//   and director decide with restraint; each hint and whether it was used is
//   visible in the DJ Event Inspector. The shape matches the director
//   consumer structurally: `fader-rise` and `filter-sweep` carry channel and
//   value, `transport` carries a string control and `on`. Extra kinds
//   (`loop-change`, `roll`, `eq-kill`) travel the same channel; consumers
//   that only know the three director kinds ignore the rest.
// - `deriveExpressiveHints`: pure detection over feed events per the T-FLX-05
//   rules: large filter sweep over `flx4.hints.filterWindowMs` reduces
//   density; pad roll emphasises spatial subdivision; channel fader rising on
//   the incoming deck advances the introduction stages (T-MIX-05); loop
//   shrink increases motion cadence; loop release marks an impact opportunity
//   at the next beat; EQ bass kill and return mark a "bass re-entry"
//   opportunity.
// - `mapHintToMixer`: pure advisory mapping onto mixer/director decisions:
//   filter sweep to density, pad roll to spatial subdivision, fader rise to
//   introduction stage (spec 67 stages), loop shrink to cadence, loop release
//   to a single impact within the restraint window (at most one impact per
//   restraint window), EQ kill/return to bass re-entry. The mixer enforces
//   restraint, not this module.
import { confirmAudible } from "./index.js";
import type { Flx4Event } from "./map.js";
import type { Flx4Signal } from "./signals.js";

export type Flx4FeedDeck = 1 | 2;

export type Flx4FeedControl =
  | "play"
  | "cue"
  | "sync"
  | "load"
  | "hotcue"
  | "loop-in"
  | "loop-out"
  | "loop-exit"
  | "loop-halve"
  | "loop-double"
  | "pad-roll"
  | "beat-jump"
  | "jog-touch"
  | "jog-move"
  | "channel-fader"
  | "crossfader"
  | "filter"
  | "eq-low"
  | "tempo";

export interface Flx4FeedEvent {
  readonly deck: Flx4FeedDeck | 0;
  readonly control: Flx4FeedControl;
  readonly value: number;
  readonly pad: number | null;
  readonly atNs: bigint;
}

export interface Flx4FeedOptions {
  capacity?: number;
}

export const FLX4_FEED_DEFAULT_CAPACITY = 256;

// Structural conversion from the deck-aware decoder: deck comes from the
// MIDI channel via the map (`event.deck`), never from the value. Jog deltas
// are signed velocities; 14-bit pairs arrive normalized 0 to 1 when complete.
// Only transport/fader/loop/pad controls the composite consumes map here;
// everything else returns null and the caller keeps it as `unknown`.
export function feedEventFromDecoded(event: Flx4Event): Flx4FeedEvent | null {
  if (event.type === "unknown") return null;
  if (!event.complete) return null;
  const atNs = event.receivedAtNs;
  if (event.group === "deck") {
    const deck = event.deck;
    if (deck === null) return null;
    const id = event.id.slice(`deck${deck}.`.length);
    if (id === "play") return { deck, control: "play", value: event.on ? 1 : 0, pad: null, atNs };
    if (id === "cue") return { deck, control: "cue", value: event.on ? 1 : 0, pad: null, atNs };
    if (id === "sync" || id === "sync-master") {
      return event.on ? { deck, control: "sync", value: 1, pad: null, atNs } : null;
    }
    if (id === "loop-in" || id === "loop-in-adjust") {
      return event.on ? { deck, control: "loop-in", value: 1, pad: null, atNs } : null;
    }
    if (id === "loop-out" || id === "loop-out-adjust") {
      return event.on ? { deck, control: "loop-out", value: 1, pad: null, atNs } : null;
    }
    if (id === "loop-exit" || id === "loop-exit-shift") {
      return event.on ? { deck, control: "loop-exit", value: 1, pad: null, atNs } : null;
    }
    if (id === "loop-halve" || id === "loop-halve-shift") {
      return event.on ? { deck, control: "loop-halve", value: 1, pad: null, atNs } : null;
    }
    if (id === "loop-double" || id === "loop-double-shift") {
      return event.on ? { deck, control: "loop-double", value: 1, pad: null, atNs } : null;
    }
    if (id === "tempo") return { deck, control: "tempo", value: event.value, pad: null, atNs };
    if (id === "jog.platter" || id === "jog.platter-pitch" || id === "jog.wheel" || id === "jog.search") {
      if (event.value === 0) return null;
      return { deck, control: "jog-move", value: event.value, pad: null, atNs };
    }
    if (id === "jog.touch" || id === "jog.touch-shift") {
      return { deck, control: "jog-touch", value: event.on ? 1 : 0, pad: null, atNs };
    }
    return null;
  }
  if (event.group === "pad") {
    const deck = event.deck;
    if (deck === null || event.padIndex === undefined || event.padMode === undefined) return null;
    if (event.padMode === "hot-cue" && !event.shift) {
      return event.on
        ? { deck, control: "hotcue", value: 1, pad: event.padIndex, atNs }
        : null;
    }
    if (event.padMode === "beat-loop" && event.shift && event.on) {
      return {
        deck,
        control: event.padIndex <= 4 ? "loop-halve" : "loop-double",
        value: 1,
        pad: event.padIndex,
        atNs,
      };
    }
    // Roll layer (Serato Roll pads, rekordbox Pad FX 2): hold is a roll.
    if (event.padMode === "pad-fx-2") {
      return { deck, control: "pad-roll", value: event.on ? 1 : 0, pad: event.padIndex, atNs };
    }
    if (event.padMode === "beat-jump" && event.on) {
      return { deck, control: "beat-jump", value: event.padIndex, pad: event.padIndex, atNs };
    }
    return null;
  }
  if (event.group === "mixer") {
    const deck = event.deck;
    if (event.id === "mixer.crossfader") {
      return { deck: 0, control: "crossfader", value: event.value, pad: null, atNs };
    }
    if (deck !== null) {
      if (event.id.endsWith(".channel-fader")) {
        return { deck, control: "channel-fader", value: event.value, pad: null, atNs };
      }
      if (event.id.endsWith(".eq-low")) {
        return { deck, control: "eq-low", value: event.value, pad: null, atNs };
      }
      if (event.id.endsWith(".cfx")) {
        return { deck, control: "filter", value: event.value, pad: null, atNs };
      }
    }
    return null;
  }
  if (event.group === "browse") {
    if (event.id.startsWith("browse.load") && event.on && event.deck !== null) {
      return { deck: event.deck, control: "load", value: 1, pad: null, atNs };
    }
    return null;
  }
  return null;
}

// Bounded latest-wins queue (S26): keeps the newest event per deck+control,
// drops the oldest deck+control bucket when over capacity, counts drops.
export class Flx4Feed {
  private readonly capacity: number;
  private readonly buckets = new Map<string, Flx4FeedEvent>();
  private order: string[] = [];
  private dropped = 0;
  private readonly unknown: Flx4Event[] = [];

  constructor(opts: Flx4FeedOptions = {}) {
    this.capacity = Math.max(1, opts.capacity ?? FLX4_FEED_DEFAULT_CAPACITY);
  }

  private keyOf(event: Flx4FeedEvent): string {
    return `${event.deck}:${event.control}:${event.pad ?? "-"}`;
  }

  // Converts and enqueues one decoded event; returns the feed event or null
  // when the decoder event maps to nothing the composite consumes. Unknown
  // raw messages and unmapped controls are kept, never dropped silently.
  ingestDecoded(event: Flx4Event): Flx4FeedEvent | null {
    const mapped = feedEventFromDecoded(event);
    if (mapped === null) {
      this.unknown.push(event);
      return null;
    }
    this.push(mapped);
    return mapped;
  }

  push(event: Flx4FeedEvent): void {
    const key = this.keyOf(event);
    if (!this.buckets.has(key)) this.order.push(key);
    this.buckets.set(key, event);
    while (this.order.length > this.capacity) {
      const oldest = this.order.shift();
      if (oldest !== undefined && this.buckets.delete(oldest)) this.dropped += 1;
    }
  }

  drain(): Flx4FeedEvent[] {
    const out = this.order
      .map((key) => this.buckets.get(key))
      .filter((event): event is Flx4FeedEvent => event !== undefined)
      .sort((a, b) => (a.atNs < b.atNs ? -1 : a.atNs > b.atNs ? 1 : 0));
    this.buckets.clear();
    this.order = [];
    return out;
  }

  depth(): number {
    return this.order.length;
  }

  droppedCount(): number {
    return this.dropped;
  }

  unknownEvents(): readonly Flx4Event[] {
    return this.unknown;
  }
}

export interface CompositeControllerInput {
  ingestControllerEvent(event: {
    deck: 1 | 2 | 0;
    control: string;
    value: number;
    pad: number | null;
    atNs: bigint;
  }): void;
}

// Drain the feed into the composite provider. Returns the drained count.
export function driveCompositeFromFeed(feed: Flx4Feed, composite: CompositeControllerInput): number {
  const events = feed.drain();
  for (const event of events) composite.ingestControllerEvent({ ...event });
  return events.length;
}

export interface Flx4ServiceLike {
  onEvent(listener: (event: Flx4Event) => void): () => void;
}

export interface Flx4ModelLike {
  apply(event: Flx4Event): void;
}

export type Flx4DeriverLike = (event: Flx4Event) => Flx4Signal[];

export interface Flx4CompositeWiring {
  readonly stop: () => void;
  readonly consumed: () => number;
  readonly signals: () => readonly Flx4Signal[];
}

// Production wiring: service events flow into the state model, signals
// derive per event, transport edges and faders reach the composite provider
// over the bounded feed. Scratch traces stay on the deriver's `scratchTrace`
// for the runtime fold-in; this wiring only forwards what the composite
// consumes. Typical use: `service.onEvent(e => model.apply(e))` plus this
// wiring on the same service.
export function subscribeServiceToComposite(
  service: Flx4ServiceLike,
  model: Flx4ModelLike,
  derive: Flx4DeriverLike,
  composite: CompositeControllerInput,
  feed: Flx4Feed = new Flx4Feed(),
): Flx4CompositeWiring {
  const seen: Flx4Signal[] = [];
  let consumed = 0;
  const stop = service.onEvent((event) => {
    model.apply(event);
    for (const signal of derive(event)) seen.push(signal);
    if (feed.ingestDecoded(event) !== null) {
      consumed += driveCompositeFromFeed(feed, composite);
    }
  });
  return {
    stop,
    consumed: () => consumed,
    signals: () => seen,
  };
}

export type ExpressiveHintKind =
  | "fader-rise"
  | "filter-sweep"
  | "transport"
  | "loop-change"
  | "roll"
  | "eq-kill";

export interface ExpressiveHint {
  readonly kind: ExpressiveHintKind;
  readonly deck: Flx4FeedDeck;
  readonly strength: number;
  readonly durationMs: number;
  readonly atNs: bigint;
  // Director-compatible payload: fader-rise/filter-sweep carry channel+value,
  // transport carries control+on, extended kinds carry detail+value.
  readonly channel: 1 | 2 | null;
  readonly value: number | null;
  readonly control: string | null;
  readonly on: boolean | null;
  readonly detail: string | null;
  readonly used: boolean;
}

export interface HintDetectorOptions {
  filterWindowMs?: number;
  restraintWindowMs?: number;
  enabled?: readonly ExpressiveHintKind[];
}

export const HINT_DEFAULTS = {
  filterWindowMs: 1500,
  restraintWindowMs: 8000,
  enabled: ["fader-rise", "filter-sweep", "transport", "loop-change", "roll", "eq-kill"] as const,
} as const;

// Pure detection over feed events. Windowed detectors (filter sweep) need
// the recent history the caller keeps; edge detectors (pads, loops, EQ kill)
// fire per event. Restraint (at most one impact per window) is enforced in
// `mapHintToMixer`, which sees every hint; this function labels candidates
// so tests can assert detection independent of restraint.
export function deriveExpressiveHints(
  events: readonly Flx4FeedEvent[],
  history: readonly Flx4FeedEvent[],
  opts: HintDetectorOptions = {},
): ExpressiveHint[] {
  const enabled = new Set<ExpressiveHintKind>(opts.enabled ?? [...HINT_DEFAULTS.enabled]);
  const filterWindowMs = opts.filterWindowMs ?? HINT_DEFAULTS.filterWindowMs;
  const out: ExpressiveHint[] = [];
  for (const event of events) {
    const ms = Number(event.atNs) / 1e6;
    if (event.control === "filter" && event.deck !== 0 && enabled.has("filter-sweep")) {
      const deck = event.deck;
      const windowStart = ms - filterWindowMs;
      const trail = history
        .filter((h) => h.control === "filter" && h.deck === event.deck && Number(h.atNs) / 1e6 >= windowStart)
        .map((h) => h.value);
      trail.push(event.value);
      const sweep = Math.max(...trail) - Math.min(...trail);
      if (sweep >= 0.4) {
        const direction = event.value >= (trail[0] ?? event.value) ? 1 : -1;
        out.push({
          kind: "filter-sweep",
          deck,
          strength: Math.min(1, sweep) * direction,
          durationMs: filterWindowMs,
          atNs: event.atNs,
          channel: deck,
          value: event.value,
          control: null,
          on: null,
          detail: direction > 0 ? "open" : "close",
          used: false,
        });
      }
    }
    if (event.control === "pad-roll" && enabled.has("roll")) {
      const deck = event.deck === 0 ? 1 : event.deck;
      out.push({
        kind: "roll",
        deck,
        strength: event.value >= 1 ? 0.8 : 0.2,
        durationMs: event.value >= 1 ? 2000 : 250,
        atNs: event.atNs,
        channel: null,
        value: event.pad,
        control: "pad-roll",
        on: event.value >= 1,
        detail: event.value >= 1 ? "start" : "stop",
        used: false,
      });
    }
    if (event.control === "channel-fader" && event.deck !== 0 && enabled.has("fader-rise")) {
      const deck = event.deck;
      const previous = [...history]
        .reverse()
        .find((h) => h.control === "channel-fader" && h.deck === event.deck);
      const rise = event.value - (previous?.value ?? 0);
      if (event.value >= 0.3 && rise >= 0.2) {
        out.push({
          kind: "fader-rise",
          deck,
          strength: Math.min(1, rise * 2),
          durationMs: 4000,
          atNs: event.atNs,
          channel: deck,
          value: event.value,
          control: null,
          on: null,
          detail: "incoming",
          used: false,
        });
      }
    }
    if (
      (event.control === "loop-halve" || event.control === "loop-double") &&
      event.value >= 1 &&
      enabled.has("loop-change")
    ) {
      const deck = event.deck === 0 ? 1 : event.deck;
      out.push({
        kind: "loop-change",
        deck,
        strength: event.control === "loop-halve" ? 0.7 : 0.4,
        durationMs: 2000,
        atNs: event.atNs,
        channel: null,
        value: null,
        control: event.control,
        on: true,
        detail: "shrink",
        used: false,
      });
    }
    if (event.control === "loop-exit" && event.value >= 1 && enabled.has("loop-change")) {
      const deck = event.deck === 0 ? 1 : event.deck;
      out.push({
        kind: "loop-change",
        deck,
        strength: 1,
        durationMs: 1000,
        atNs: event.atNs,
        channel: null,
        value: null,
        control: "loop-exit",
        on: true,
        detail: "release",
        used: false,
      });
    }
    if (event.control === "eq-low" && enabled.has("eq-kill")) {
      const deck = event.deck === 0 ? 1 : event.deck;
      if (event.value <= 0.05) {
        out.push({
          kind: "eq-kill",
          deck,
          strength: 0.9,
          durationMs: 4000,
          atNs: event.atNs,
          channel: null,
          value: event.value,
          control: "eq-low",
          on: true,
          detail: "kill",
          used: false,
        });
      } else if (event.value >= 0.4) {
        const killed = [...history]
          .reverse()
          .find((h) => h.control === "eq-low" && h.deck === event.deck && h.value <= 0.05);
        if (killed) {
          out.push({
            kind: "eq-kill",
            deck,
            strength: 1,
            durationMs: 2000,
            atNs: event.atNs,
            channel: null,
            value: event.value,
            control: "eq-low",
            on: false,
            detail: "re-entry",
            used: false,
          });
        }
      }
    }
    if (
      (event.control === "play" ||
        event.control === "cue" ||
        event.control === "hotcue" ||
        event.control === "load" ||
        event.control === "beat-jump") &&
      event.value >= 1 &&
      enabled.has("transport")
    ) {
      const deck = event.deck === 0 ? 1 : event.deck;
      out.push({
        kind: "transport",
        deck,
        strength: 0.5,
        durationMs: 1000,
        atNs: event.atNs,
        channel: null,
        value: null,
        control: event.control,
        on: true,
        detail: null,
        used: false,
      });
    }
  }
  return out;
}

export type MixerHintAction =
  | { action: "reduce-density"; amount: number }
  | { action: "subdivide-spatial"; beats: number }
  | { action: "advance-intro"; stage: "palette" | "rhythm" | "impacts" }
  | { action: "raise-cadence"; amount: number }
  | { action: "impact-on-next-beat"; atNs: bigint }
  | { action: "mark-bass-reentry"; atNs: bigint }
  | { action: "accent-phrase-change"; control: string }
  | { action: "ignore"; reason: string };

export interface MixerHintContext {
  // Fader-confirmed audibility per deck (T-MIX-01 DS-26 `controller` source):
  // both the MIDI fader and the DJ weight must agree.
  audible: (deck: Flx4FeedDeck) => boolean;
  // Restraint gate: true when an impact is allowed now (T-PLAN-05 budgets
  // apply to live decisions too). The mixer owns this clock.
  impactAllowed: (atNs: bigint) => boolean;
  // Last impact hint time, for the at-most-one-impact-per-window proof.
  lastImpactAtNs?: bigint | null;
  restraintWindowMs?: number;
}

export function confirmControllerAudible(midiFader: number | null, djWeight: number): boolean {
  return confirmAudible(midiFader, djWeight);
}

// Pure advisory mapping onto mixer/director decisions. Never emits lighting;
// every branch either maps to a budgeted decision or to `ignore` with the
// reason, so the DJ Event Inspector can show whether the hint was used.
export function mapHintToMixer(
  hint: ExpressiveHint,
  ctx: MixerHintContext,
): { mapped: MixerHintAction; used: ExpressiveHint } {
  const mark = (used: boolean): ExpressiveHint => ({ ...hint, used });
  switch (hint.kind) {
    case "filter-sweep": {
      if (!ctx.audible(hint.deck)) {
        return { mapped: { action: "ignore", reason: "deck not audible" }, used: mark(false) };
      }
      return { mapped: { action: "reduce-density", amount: Math.abs(hint.strength) }, used: mark(true) };
    }
    case "roll": {
      if (!ctx.audible(hint.deck)) {
        return { mapped: { action: "ignore", reason: "deck not audible" }, used: mark(false) };
      }
      const beats = hint.value ?? 0.5;
      return { mapped: { action: "subdivide-spatial", beats }, used: mark(true) };
    }
    case "fader-rise": {
      if (!ctx.audible(hint.deck)) {
        return { mapped: { action: "ignore", reason: "deck not audible" }, used: mark(false) };
      }
      const level = hint.value ?? 0;
      const stage = level >= 0.7 ? "impacts" : level >= 0.3 ? "rhythm" : "palette";
      return { mapped: { action: "advance-intro", stage }, used: mark(true) };
    }
    case "loop-change": {
      if (hint.detail === "release") {
        const windowMs = ctx.restraintWindowMs ?? HINT_DEFAULTS.restraintWindowMs;
        const last = ctx.lastImpactAtNs ?? null;
        if (last !== null && Number(hint.atNs - last) / 1e6 < windowMs) {
          return { mapped: { action: "ignore", reason: "impact restraint window" }, used: mark(false) };
        }
        if (!ctx.impactAllowed(hint.atNs)) {
          return { mapped: { action: "ignore", reason: "impact not allowed" }, used: mark(false) };
        }
        return { mapped: { action: "impact-on-next-beat", atNs: hint.atNs }, used: mark(true) };
      }
      if (!ctx.audible(hint.deck)) {
        return { mapped: { action: "ignore", reason: "deck not audible" }, used: mark(false) };
      }
      return { mapped: { action: "raise-cadence", amount: hint.strength }, used: mark(true) };
    }
    case "eq-kill": {
      if (hint.detail !== "re-entry") {
        return { mapped: { action: "ignore", reason: "kill arms re-entry" }, used: mark(false) };
      }
      if (!ctx.audible(hint.deck)) {
        return { mapped: { action: "ignore", reason: "deck not audible" }, used: mark(false) };
      }
      return { mapped: { action: "mark-bass-reentry", atNs: hint.atNs }, used: mark(true) };
    }
    case "transport": {
      if (!ctx.audible(hint.deck)) {
        return { mapped: { action: "ignore", reason: "deck not audible" }, used: mark(false) };
      }
      return { mapped: { action: "accent-phrase-change", control: hint.control ?? "play" }, used: mark(true) };
    }
  }
}
