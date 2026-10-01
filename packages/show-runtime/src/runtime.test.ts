import { describe, expect, it } from "vitest";
import { makeDeck } from "@autolight/simulator";
import type { ShowPlan, TrackModel } from "@autolight/contracts";
import {
  MAX_DECKS,
  ShowRuntime,
  createDeckWorld,
  evaluateCues,
  ingestDeck,
  initialOverrideState,
  installModel,
  installPlan,
  loopBeat,
  loopPassVariant,
  overrideEffect,
  quantizeResume,
  resumeGridFromModel,
  rollDegradeChoice,
  seekWorld,
  setOverride,
  tickWorld,
  upcomingCues,
  varyCueForPass,
  type DeckWorld,
} from "./index.js";

const BPM = 120; // 2 beats per second: playhead seconds map cleanly onto beats
const NS_PER_SECOND = 1_000_000_000n;

const plan: ShowPlan = {
  schemaVersion: 1,
  plannerVersion: "test",
  trackId: "t",
  styleId: "s",
  seed: "a",
  cues: [
    { type: "section-look", startBeat: 64, durationBeats: 32, intensity: 0.8, target: "PRIMARY", priority: 10 },
    { type: "chase-flip", startBeat: 128, durationBeats: 32, intensity: 0.6, target: "LEFT", priority: 11 },
    { type: "impact", startBeat: 128, durationBeats: 1, intensity: 0.9, target: "ALL", priority: 90 },
    { type: "white-hit", startBeat: 300, durationBeats: 0.25, intensity: 1, target: "ALL", priority: 100 },
    { type: "blackout", startBeat: 256, durationBeats: 1, intensity: 0, target: "ALL", priority: 95 },
    { type: "build-ramp", startBeat: 200, durationBeats: 8, intensity: 0.6, target: "ALL", priority: 50 },
  ],
};

function deckWorld(deckId = 1, beat = 0): DeckWorld {
  const world = createDeckWorld(deckId, { startBeat: beat });
  installPlan(world, 1, plan);
  return world;
}

function observe(world: DeckWorld, playheadSeconds: number, nowNs: bigint, over: Parameters<typeof makeDeck>[0] = {}) {
  ingestDeck(
    world,
    makeDeck({
      deckId: world.deckId,
      effectiveBpm: BPM,
      playheadSeconds,
      receivedAtNs: nowNs,
      channelFader: 1,
      crossfader: 1,
      ...over,
    }),
    "exact",
  );
  return tickWorld(world, nowNs);
}

describe("show runtime", () => {
  it("evaluates the newest DeckState and drops stale observations (T-RUN-01)", () => {
    const world = deckWorld();
    expect(ingestDeck(world, makeDeck({ playheadSeconds: 5, receivedAtNs: 100n, effectiveBpm: BPM }), "exact")).toBe(true);
    expect(ingestDeck(world, makeDeck({ playheadSeconds: 1, receivedAtNs: 50n, effectiveBpm: BPM }), "exact")).toBe(false);
    expect(world.state?.playheadSeconds).toBe(5);
    // The tick reads the newest state, never a queue.
    const tick = tickWorld(world, 100n);
    expect(tick?.beat).toBeCloseTo(10, 6);
  });

  it("evaluates two deck worlds independently (P-62-two-worlds)", () => {
    const runtime = new ShowRuntime({ deckIds: [1, 2] });
    runtime.installPlan(1, 1, plan);
    runtime.installPlan(2, 1, { ...plan, trackId: "u" });
    runtime.ingest(1, makeDeck({ deckId: 1, effectiveBpm: BPM, playheadSeconds: 64, receivedAtNs: 0n }), "exact");
    runtime.ingest(2, makeDeck({ deckId: 2, effectiveBpm: BPM, playheadSeconds: 150, receivedAtNs: 0n }), "exact");
    const ticks = runtime.tick(0n);
    expect(ticks.map((t) => t.deckId)).toEqual([1, 2]);
    expect(ticks[0]!.beat).toBeCloseTo(128, 6);
    expect(ticks[1]!.beat).toBeCloseTo(300, 6);
    expect(ticks[0]!.cues.map((c) => c.type)).toContain("impact");
    expect(ticks[1]!.cues.map((c) => c.type)).toContain("white-hit");
    expect(runtime.decks()).toHaveLength(2);
  });

  it("holds at most four deck worlds (spec 62, T-RUN-01)", () => {
    const runtime = new ShowRuntime();
    for (let i = 1; i <= MAX_DECKS; i += 1) runtime.world(i);
    expect(() => runtime.world(MAX_DECKS + 1)).toThrow(/at most 4 deck worlds/);
  });

  it("seeks as random access within one tick and cancels abandoned transients (P-58-seek)", () => {
    const world = deckWorld(1, 300);
    const before = observe(world, 150, 0n); // playhead 150 s = beat 300
    expect(before?.transients.map((c) => c.type)).toContain("white-hit");

    // Hot cue from 300 to 64: the next observation is a transport event.
    const after = observe(world, 32, NS_PER_SECOND); // playhead 32 s = beat 64
    expect(after?.seeked).toBe(true);
    expect(after?.beat).toBe(64);
    expect(after?.cues.map((c) => c.type)).toEqual(["section-look"]);
    expect(after?.transients).toEqual([]);
    expect(world.cancelled.map((c) => c.type)).toContain("white-hit");

    // Paused hot cue: the state at the new beat is reconstructed and held.
    const paused = deckWorld(2, 300);
    observe(paused, 150, 0n, { playing: false });
    const held = observe(paused, 32, NS_PER_SECOND, { playing: false }); // playhead 32 s = beat 64
    expect(held?.seeked).toBe(true);
    expect(held?.beat).toBe(64);
    expect(held?.cues.map((c) => c.type)).toEqual(["section-look"]);
    expect(paused.cancelled.map((c) => c.type)).toContain("white-hit");
    expect(observe(paused, 32, 2n * NS_PER_SECOND, { playing: false })?.beat).toBeCloseTo(64, 6);
  });

  it("renders at a beat after any seek history exactly as from a fresh cursor (P-58-seek)", () => {
    const history = deckWorld();
    let seed = 5;
    const rand = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    const beats = [0, 64, 128, 256, 300, 200, 129, 300.2, 64.5, 257];
    for (const b of beats) {
      // History mixes seeks, loops and scratch holds before the sample.
      seekWorld(history, b, BigInt(Math.round(b * 1000)));
      observe(history, b / 2, BigInt(Math.round(b * 1000)), { loop: { active: true, startSeconds: 64, endSeconds: 68, beatLength: 8 } });
      observe(history, rand() * 200, BigInt(Math.round(rand() * 1000)), { playRate: 0.3 });
    }
    for (const b of [64, 128, 200, 256.5, 300.1, 129.5]) {
      const fresh = deckWorld(9, b);
      const expected = fresh.plan === null ? [] : evaluateCues(fresh.plan, b);
      const actual = seekWorld(history, b, 0n).cues;
      expect(actual, `beat ${b}`).toEqual(expected);
    }
    // Every cue type in the plan is covered by the reconstruction check.
    expect(new Set(plan.cues.map((c) => c.type)).size).toBe(6);
  });

  it("loops the region with pass variation that preserves section identity (P-59-loop)", () => {
    const world = deckWorld();
    const loop = { active: true, startSeconds: 64, endSeconds: 68, beatLength: 8 };
    const pass0 = observe(world, 64, 0n, { loop });
    const pass1 = observe(world, 68, NS_PER_SECOND, { loop });
    const pass2 = observe(world, 72, 2n * NS_PER_SECOND, { loop });
    expect([pass0?.loopPass, pass1?.loopPass, pass2?.loopPass]).toEqual([0, 1, 2]);
    expect([pass0?.beat, pass1?.beat, pass2?.beat]).toEqual([128, 128, 128]);
    // A hit at the loop start fires on every pass, not once.
    for (const pass of [pass0, pass1, pass2]) {
      expect(pass?.transients.map((c) => c.type)).toContain("impact");
    }
    // A, B, A: pass 2 repeats pass 0; pass 1 is the variation, and the cue
    // identity (type, start beat, priority) is untouched on every pass.
    const shape = (p: typeof pass0): string =>
      JSON.stringify((p?.cues ?? []).map((c) => [c.type, c.startBeat, c.priority, c.target, c.intensity]));
    expect(shape(pass2)).toBe(shape(pass0));
    expect(shape(pass1)).not.toBe(shape(pass0));
    expect(loopPassVariant(0)).toBe(loopPassVariant(2));
    expect(loopPassVariant(1)).toBe(1);
    expect(loopPassVariant(2, "rotate-3")).toBe(2);
    expect(loopPassVariant(3, "none")).toBe(0);
    const varied = varyCueForPass(plan.cues[1]!, 1);
    expect(varied.type).toBe("chase-flip");
    expect(varied.startBeat).toBe(128);
    expect(varied.target).not.toBe(plan.cues[1]!.target);
  });

  it("folds loop sizes from a bar down to a 1/16 roll", () => {
    expect(loopBeat(140, 129, 133)).toEqual({ beat: 132, pass: 2 });
    expect(loopBeat(129.75, 129, 129.5)).toEqual({ beat: 129.25, pass: 1 });
    const sixteenth = loopBeat(200.34, 200.3125, 200.375);
    expect(sixteenth.pass).toBe(0);
    expect(sixteenth.beat).toBeCloseTo(200.34, 6);
  });

  it("degrades tiny rolls by the qualified fixture rate (P-60-roll-degrade)", () => {
    // A 1/16 (0.25 beat) roll toggles 8 Hz at 120 BPM: a 20 Hz fixture cannot
    // sample it, a 60 Hz fixture can.
    expect(rollDegradeChoice({ rollBeats: 0.25, bpm: 120, fixtureFps: 20 })).toBe("pulse");
    expect(rollDegradeChoice({ rollBeats: 0.25, bpm: 120, fixtureFps: 60 })).toBe("full");
    // A slower 1/2-beat roll is showable on the same 20 Hz fixture.
    expect(rollDegradeChoice({ rollBeats: 0.5, bpm: 120, fixtureFps: 20 })).toBe("full");
    // The degrade order is configurable and taken in order.
    expect(rollDegradeChoice({ rollBeats: 0.25, bpm: 120, fixtureFps: 20, order: ["contraction", "impact"] })).toBe("contraction");
  });

  it("holds the look during a scratch and resyncs at the next bar (P-61-scratch)", () => {
    const model: TrackModel = {
      schemaVersion: 1,
      analyzerVersion: "test",
      identity: { id: "t", sourceIds: {} },
      durationSeconds: 300,
      beatGrid: {
        version: 1,
        beats: Array.from({ length: 512 }, (_, i) => ({
          index: i,
          beatInBar: ((i % 4) + 1) as 1 | 2 | 3 | 4,
          sourceTimeMs: i * 500,
          bpm: BPM,
        })),
      },
      sections: [{ kind: "drop", startBeat: 256, endBeat: 320, confidence: 1 }],
      musicalEvents: [{ type: "drop", beat: 256, confidence: 1 }],
      analysisCoverage: "full",
    };
    const world = deckWorld(1, 200);
    installModel(world, 1, model);
    const loopFree = { loop: { active: false, startSeconds: null, endSeconds: null, beatLength: null } };

    const held = observe(world, 100, 0n, { ...loopFree, playRate: 0.2 }); // jog, beat 200
    expect(held?.scratchHold).toBe(true);
    const heldBeat = held?.beat ?? 0;
    // A further jog does not move the design (at most the limited modulation).
    const jogged = observe(world, 120, NS_PER_SECOND, { ...loopFree, playRate: 0.2 });
    expect(jogged?.scratchHold).toBe(true);
    expect(Math.abs((jogged?.beat ?? 0) - heldBeat)).toBeLessThanOrEqual(0.25);

    // Forward playback is stable again: the hold ends at the next native
    // downbeat (bar), not at a multiple of four beats from the held position.
    const notYet = observe(world, 121, 2n * NS_PER_SECOND, loopFree); // beat 242, boundary is 244
    expect(notYet?.scratchHold).toBe(true);
    expect(quantizeResume(242, "bar", resumeGridFromModel(model))).toBe(244);
    const resumed = observe(world, 122.5, 3n * NS_PER_SECOND, loopFree); // beat 245 >= 244
    expect(resumed?.scratchHold).toBe(false);
    expect(resumed?.beat).toBeCloseTo(245, 6);
    expect(world.scratch.resyncBeat).toBeNull();
    expect(heldBeat).toBeLessThan(resumed?.beat ?? 0);

    // Reversals (a jog trace) enter the hold; a steady reverse follows backward.
    const reverse = deckWorld(3, 200);
    const back1 = observe(reverse, 100, 0n, { ...loopFree, playRate: -1 });
    const back2 = observe(reverse, 98, NS_PER_SECOND, { ...loopFree, playRate: -1 });
    expect(back1?.scratchHold).toBe(false);
    expect(back2?.beat).toBeCloseTo(196, 6);
    expect(back2?.beat).toBeLessThan(back1?.beat ?? 0);

    const jogTrace = deckWorld(4, 200);
    observe(jogTrace, 100, 0n, { ...loopFree, playRate: -1 });
    observe(jogTrace, 101, 100_000_000n, { ...loopFree, playRate: 1 });
    const scratchy = observe(jogTrace, 100.5, 200_000_000n, { ...loopFree, playRate: -1 });
    expect(scratchy?.scratchHold).toBe(true);
  });

  it("applies every manual override and resume mode (T-RUN-07, spec 134)", () => {
    const model: TrackModel = {
      schemaVersion: 1,
      analyzerVersion: "test",
      identity: { id: "t", sourceIds: {} },
      durationSeconds: 300,
      beatGrid: {
        version: 1,
        beats: Array.from({ length: 128 }, (_, i) => ({
          index: i,
          beatInBar: ((i % 4) + 1) as 1 | 2 | 3 | 4,
          sourceTimeMs: i * 500,
          bpm: BPM,
        })),
      },
      sections: [{ kind: "chorus", startBeat: 96, endBeat: 128, confidence: 1 }],
      musicalEvents: [],
      analysisCoverage: "full",
    };
    const grid = resumeGridFromModel(model);
    expect(grid.barBeats.slice(0, 3)).toEqual([0, 4, 8]);
    expect(grid.phraseBeats).toEqual([96]);

    let state = initialOverrideState();
    expect(overrideEffect(state).kind).toBe("none");
    expect(overrideEffect(state).factor).toBe(1);

    // Emergency controls take effect immediately: no queue, no rounding.
    state = setOverride(state, "blackout", { beat: 33.2 });
    expect(state.pendingResume).toBe(false);
    expect(overrideEffect(state)).toMatchObject({ kind: "blackout", factor: 0, white: null, hold: false });
    state = setOverride(state, "white", { beat: 33.2 });
    expect(overrideEffect(state)).toMatchObject({ kind: "white", white: 1, hold: false });
    state = setOverride(state, "freeze", { beat: 33.2 });
    expect(overrideEffect(state)).toMatchObject({ kind: "freeze", hold: true });
    state = setOverride(state, "force-low", { beat: 33.2 });
    expect(overrideEffect(state)).toMatchObject({ kind: "force-low", energy: 0.25 });
    state = setOverride(state, "force-high", { beat: 33.2 });
    expect(overrideEffect(state)).toMatchObject({ kind: "force-high", energy: 1 });

    // Master intensity scales the manual layer, and white is RGB white.
    state = setOverride(state, "white", { beat: 33.2, whiteIntensity: 0.5 });
    expect(overrideEffect(state, 0.5).white).toBeCloseTo(0.25, 6);

    // Resume modes: default is bar, and bars and phrases come from the model.
    const defaultResume = setOverride(state, "none", { beat: 33.2 });
    expect(defaultResume.resumeAt).toBe("bar");
    expect(defaultResume.resumeBeat).toBe(36);
    expect(setOverride(state, "none", { beat: 33.2, at: "beat" }).resumeBeat).toBe(34);
    expect(setOverride(state, "none", { beat: 33.2, at: "bar", grid }).resumeBeat).toBe(36);
    expect(setOverride(state, "none", { beat: 33.2, at: "phrase", grid }).resumeBeat).toBe(96);
    const immediate = setOverride(state, "none", { beat: 33.2, at: "immediate" });
    expect(immediate.resumeBeat).toBe(33.2);
    expect(immediate.pendingResume).toBe(false);

    // The pending resume lands on the boundary, never mid-bar.
    const world = deckWorld(1, 32);
    world.override = setOverride(world.override, "blackout", { beat: 32 });
    observe(world, 17, 0n, { loop: { active: false, startSeconds: null, endSeconds: null, beatLength: null } });
    world.override = setOverride(world.override, "none", { beat: 34, at: "bar", grid });
    const beforeBoundary = observe(world, 17.5, 100_000_000n, { loop: { active: false, startSeconds: null, endSeconds: null, beatLength: null } });
    expect(beforeBoundary?.clockHealth).toBe("live");
    expect(world.override.kind).toBe("none");
    expect(world.override.pendingResume).toBe(true);
    const atBoundary = observe(world, 18, 200_000_000n, { loop: { active: false, startSeconds: null, endSeconds: null, beatLength: null } });
    expect(atBoundary?.beat).toBeCloseTo(36, 6);
    expect(world.override.pendingResume).toBe(false);
  });

  it("publishes upcoming cues per deck for the UI (T-MIX-06)", () => {
    const upcoming = upcomingCues(plan, 64, 3);
    expect(upcoming.map((c) => c.startBeat)).toEqual([128, 128, 200]);
    expect(upcoming[0]!.durationBeats).toBe(1);
    expect(upcoming[1]!.durationBeats).toBe(32);
    expect(upcomingCues(plan, 400)).toEqual([]);
  });
});
