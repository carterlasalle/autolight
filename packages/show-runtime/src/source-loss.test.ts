// T-RUN-06: source loss, device faults and the adaptive clock (P-105-source-loss,
// spec 105, 107, DS-23).
//
// The fault matrix drops the provider for 300 ms, 1.5 s and 10 s while the
// deck keeps playing. The runtime must extrapolate, then hold the estimate
// with faded motion, then run on the adaptive clock, and in all three windows
// the plan must still evaluate: loss alone never blanks the show. The
// adaptive clock's beat error after a 10 s loss is measured against the true
// beat.

import { describe, expect, it } from "vitest";
import { makeDeck } from "@autolight/simulator";
import type { ShowPlan } from "@autolight/contracts";
import {
  HOLD_MOTION_FLOOR,
  LOGICAL_TICK_HZ,
  adaptiveBeat,
  createDeckWorld,
  deviceFrameDue,
  dueDevicesOnTick,
  ingestDeck,
  installPlan,
  motionFactor,
  setAudioTempo,
  tickWorld,
  type AdaptiveClockInputs,
  type AdaptiveClockMode,
  type DeckWorld,
  type DeviceRuntimeState,
} from "./index.js";

const BPM = 120; // 2 beats per second
const NS_PER_SECOND = 1_000_000_000n;
const NS_PER_MS = 1_000_000n;

const plan: ShowPlan = {
  schemaVersion: 1,
  plannerVersion: "test",
  trackId: "t",
  styleId: "s",
  seed: "a",
  cues: [
    { type: "section-look", startBeat: 64, durationBeats: 64, intensity: 0.8, target: "PRIMARY", priority: 10 },
  ],
};

function deckWorld(adaptiveMode?: AdaptiveClockMode) {
  const world = createDeckWorld(1, adaptiveMode === undefined ? {} : { adaptiveMode });
  installPlan(world, 1, plan);
  return world;
}

function observe(world: DeckWorld, playheadSeconds: number, nowNs: bigint) {
  ingestDeck(
    world,
    makeDeck({ deckId: 1, effectiveBpm: BPM, playheadSeconds, receivedAtNs: nowNs, channelFader: 1, crossfader: 1 }),
    "exact",
  );
  return tickWorld(world, nowNs);
}

const EMPTY_INPUTS: AdaptiveClockInputs = {
  djBpm: null,
  djBeat: null,
  djAnchorNs: null,
  audioBpm: null,
  audioBeat: null,
  audioAnchorNs: null,
  audioConfidence: 0,
};

describe("source loss and the adaptive clock (T-RUN-06)", () => {
  it("keeps the plan alive across 300 ms, 1.5 s and 10 s of source loss", () => {
    const world = deckWorld();
    const present = observe(world, 32, 0n); // playhead 32 s = beat 64
    expect(present?.clockHealth).toBe("live");
    expect(present?.clockSource).toBe("provider");
    expect(present?.motion).toBe(1);
    expect(present?.cues.map((c) => c.type)).toEqual(["section-look"]);

    // 300 ms: still inside runtime.health.extrapolateMs, the beat advances.
    const gap300 = tickWorld(world, 300n * NS_PER_MS);
    expect(gap300?.clockHealth).toBe("extrapolating");
    expect(gap300?.clockSource).toBe("provider");
    expect(gap300?.motion).toBe(1);
    expect(gap300!.beat).toBeGreaterThan(64.4);
    expect(gap300!.cues.map((c) => c.type)).toEqual(["section-look"]);

    // 1.5 s: holding, the estimate is frozen and motion fades.
    const held = tickWorld(world, 1_500n * NS_PER_MS);
    expect(held?.clockHealth).toBe("holding");
    expect(held?.clockSource).toBe("hold");
    expect(held!.motion).toBeLessThan(1);
    expect(held!.motion).toBeGreaterThanOrEqual(HOLD_MOTION_FLOOR);
    expect(held!.cues.map((c) => c.type)).toEqual(["section-look"]);

    const stillHeld = tickWorld(world, 1_900n * NS_PER_MS);
    expect(stillHeld!.beat).toBeCloseTo(held!.beat, 9);
    expect(stillHeld!.motion).toBeLessThan(held!.motion);

    // 10 s: degraded, the adaptive clock resumes from the last known tempo
    // and phase: beat 64 at 0 s, 120 BPM, so beat 84 at 10 s.
    const degraded = tickWorld(world, 10n * NS_PER_SECOND);
    expect(degraded?.clockHealth).toBe("degraded");
    expect(degraded?.clockSource).toBe("adaptive");
    expect(degraded!.beat).toBeCloseTo(84, 6);
    expect(degraded!.cues.map((c) => c.type)).toEqual(["section-look"]);

    // A fresh observation hands the clock back to the provider.
    const recovered = observe(world, 42, 10n * NS_PER_SECOND);
    expect(recovered?.clockHealth).toBe("live");
    expect(recovered?.clockSource).toBe("provider");
    expect(recovered?.motion).toBe(1);
  });

  it("measures the adaptive clock's beat error after a 10 s loss", () => {
    const world = deckWorld();
    observe(world, 32, 0n);
    const degraded = tickWorld(world, 10n * NS_PER_SECOND)!;
    const trueBeat = 64 + (10 * BPM) / 60;
    const errorMs = (Math.abs(degraded.beat - trueBeat) / (BPM / 60)) * 1000;
    expect(degraded.clockSource).toBe("adaptive");
    expect(errorMs).toBeLessThan(20);
  });

  it("blends the live audio tempo with the last known DJ tempo (DS-23)", () => {
    const world = deckWorld("blend");
    observe(world, 32, 0n);
    setAudioTempo(world, { bpm: 128, confidence: 1, beat: null, anchorNs: null });
    const degraded = tickWorld(world, 10n * NS_PER_SECOND)!;
    // Blend bpm = (120 + 128) / 2 = 124, phase from the last known provider
    // anchor at beat 64.
    expect(degraded.clockSource).toBe("adaptive");
    expect(degraded.beat).toBeCloseTo(64 + (10 * 124) / 60, 6);
  });

  it("follows the live audio phase in audio-onset mode", () => {
    const world = deckWorld("audio-onset");
    observe(world, 32, 0n);
    setAudioTempo(world, { bpm: 128, confidence: 1, beat: 64, anchorNs: 0n });
    const degraded = tickWorld(world, 10n * NS_PER_SECOND)!;
    expect(degraded.beat).toBeCloseTo(64 + (10 * 128) / 60, 6);
  });

  it("adaptive clock: dj-bpm phase, audio-onset tempo, confidence-weighted blend", () => {
    const now = 10n * NS_PER_SECOND;
    const inputs: AdaptiveClockInputs = {
      djBpm: 120,
      djBeat: 64,
      djAnchorNs: 0n,
      audioBpm: 128,
      audioBeat: 0,
      audioAnchorNs: 0n,
      audioConfidence: 1,
    };
    const dj = adaptiveBeat(inputs, now, "dj-bpm")!;
    expect(dj.bpm).toBe(120);
    expect(dj.beat).toBeCloseTo(84, 9);
    const audio = adaptiveBeat(inputs, now, "audio-onset")!;
    expect(audio.bpm).toBe(128);
    expect(audio.beat).toBeCloseTo((10 * 128) / 60, 9);
    const blend = adaptiveBeat(inputs, now, "blend")!;
    expect(blend.source).toBe("blend");
    expect(blend.bpm).toBeCloseTo(124, 9);
    expect(blend.beat).toBeCloseTo(64 + (10 * 124) / 60, 9);
    // Zero audio confidence falls back to the provider tempo alone.
    expect(adaptiveBeat({ ...inputs, audioConfidence: 0 }, now, "blend")!.source).toBe("dj-bpm");
    // No inputs at all: no fabricated clock.
    expect(adaptiveBeat(EMPTY_INPUTS, now)).toBeNull();
  });

  it("blending a confident live tempo beats dj-bpm alone when the deck pitched", () => {
    const now = 10n * NS_PER_SECOND;
    const truthBpm = 128;
    const truthBeat = 64 + (10 * truthBpm) / 60;
    const djOnly = adaptiveBeat(
      { ...EMPTY_INPUTS, djBpm: 120, djBeat: 64, djAnchorNs: 0n },
      now,
      "blend",
    )!;
    const blended = adaptiveBeat(
      { ...EMPTY_INPUTS, djBpm: 120, djBeat: 64, djAnchorNs: 0n, audioBpm: 128, audioConfidence: 1 },
      now,
      "blend",
    )!;
    expect(Math.abs(djOnly.beat - truthBeat)).toBeGreaterThan(Math.abs(blended.beat - truthBeat));
    expect(Math.abs(blended.beat - truthBeat)).toBeLessThan(1);
  });

  it("fades motion while the clock holds (spec 105)", () => {
    expect(motionFactor("live", 0)).toBe(1);
    expect(motionFactor("extrapolating", 400)).toBe(1);
    expect(motionFactor("holding", 1_000)).toBeLessThan(1);
    expect(motionFactor("holding", 1_000)).toBeGreaterThan(HOLD_MOTION_FLOOR);
    expect(motionFactor("holding", 2_000)).toBeCloseTo(HOLD_MOTION_FLOOR, 9);
    expect(motionFactor("degraded", 10_000)).toBeCloseTo(HOLD_MOTION_FLOOR, 9);
  });
});

describe("device faults (T-RUN-06, spec 107)", () => {
  const devices: DeviceRuntimeState[] = [
    { deviceId: "lamp-a", capability: "segmented", fps: 60, online: true },
    { deviceId: "lamp-b", capability: "single-zone", fps: 20, online: true },
    { deviceId: "strip", capability: "segmented", fps: 60, online: false },
  ];

  it("keeps the logical 60 Hz for healthy devices while faulted ones drop out", () => {
    const counts: Record<string, number> = {};
    for (let tick = 0; tick < LOGICAL_TICK_HZ; tick += 1) {
      for (const device of dueDevicesOnTick(devices, tick)) {
        counts[device.deviceId] = (counts[device.deviceId] ?? 0) + 1;
      }
    }
    expect(counts["lamp-a"]).toBe(60);
    expect(counts["lamp-b"]).toBe(20);
    expect(counts["strip"]).toBeUndefined();
    expect(dueDevicesOnTick(devices, 3).map((d) => d.deviceId)).toEqual(["lamp-a"]);
  });

  it("isolates a fault: another device's rate never changes", () => {
    const healthy: DeviceRuntimeState = { deviceId: "lamp-a", capability: "segmented", fps: 60, online: true };
    let due = 0;
    for (let tick = 0; tick < LOGICAL_TICK_HZ; tick += 1) {
      if (deviceFrameDue(healthy, tick)) due += 1;
    }
    expect(due).toBe(60);
    // The same device while a neighbour is offline: still every logical tick.
    const faulted: DeviceRuntimeState = { deviceId: "lamp-b", capability: "single-zone", fps: 20, online: false };
    let dueWithFault = 0;
    for (let tick = 0; tick < LOGICAL_TICK_HZ; tick += 1) {
      if (dueDevicesOnTick([healthy, faulted], tick).some((d) => d.deviceId === "lamp-a")) dueWithFault += 1;
    }
    expect(dueWithFault).toBe(60);
    expect(deviceFrameDue(healthy, -1)).toBe(false);
    expect(deviceFrameDue(faulted, 0)).toBe(false);
  });
});
