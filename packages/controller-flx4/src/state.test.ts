// T-FLX-03: controller state model tests driven by captured sequences.

import { describe, expect, it } from "vitest";
import { Flx4Decoder, FOURTEEN_BIT_STEPS, fourteenBit } from "./map.js";
import { Flx4StateModel, TempoRangeFit, pitchForPosition, resolveTempoRange, type TempoFitSample } from "./state.js";

type Row = readonly [status: number, data1: number, data2: number];

function feed(model: Flx4StateModel, rows: readonly Row[], startNs = 1_000_000n): bigint {
  const decoder = new Flx4Decoder();
  let atNs = startNs;
  for (const [status, data1, data2] of rows) {
    atNs += 1_000_000n;
    model.apply(decoder.decode({ status, data1, data2, receivedAtNs: atNs }));
  }
  return atNs;
}

describe("flx4 state model", () => {
  it("follows LOAD, PLAY, jog touch and release with timestamps and quality", () => {
    const model = new Flx4StateModel();
    const last = feed(model, [
      [0x96, 0x46, 0x7f], // LOAD deck 1
      [0x90, 0x0b, 0x7f], // PLAY
      [0x90, 0x36, 0x7f], // jog platter touch
      [0xb0, 0x22, 0x45], // jog clockwise
      [0xb0, 0x22, 0x3b], // jog counterclockwise, one reversal
      [0x90, 0x36, 0x00], // release
    ]);
    const snapshot = model.snapshot();
    const deck = snapshot.decks[1];
    expect(deck.loads.count).toBe(1);
    expect(deck.loads.lastAtNs).not.toBeNull();
    expect(deck.play).toEqual({ on: true, atNs: 3_000_000n, quality: "estimated" });
    expect(deck.cue.on).toBe(false);
    expect(deck.jog.touched).toBe(false);
    expect(deck.jog.direction).toBe(-1);
    expect(deck.jog.velocity).toBe(-5);
    expect(deck.jog.reversals).toEqual([6_000_000n]);
    expect(deck.jog.atNs).toBe(last);
    expect(snapshot.updatedAtNs).toBe(last);
    expect(snapshot.eventsApplied).toBe(6);
  });

  it("toggles play, sync and master from button presses", () => {
    const model = new Flx4StateModel();
    feed(model, [
      [0x90, 0x0b, 0x7f],
      [0x90, 0x0b, 0x7f],
      [0x90, 0x58, 0x7f],
      [0x90, 0x58, 0x7f],
      [0x90, 0x5c, 0x7f],
    ]);
    const deck = model.snapshot().decks[1];
    expect(deck.play.on).toBe(false);
    expect(deck.sync.enabled).toBe(false);
    expect(deck.sync.master).toBe(true);
    expect(deck.sync.quality).toBe("estimated");
  });

  it("keeps SHIFT, pad mode and pressed pads", () => {
    const model = new Flx4StateModel();
    feed(model, [
      [0x90, 0x3f, 0x7f], // SHIFT down
      [0x90, 0x1b, 0x7f], // HOT CUE mode
      [0x97, 0x00, 0x7f], // hot cue pad 1
      [0x97, 0x01, 0x7f], // hot cue pad 2
      [0x97, 0x01, 0x00], // pad 2 up
      [0x90, 0x3f, 0x00], // SHIFT up
    ]);
    const deck = model.snapshot().decks[1];
    expect(deck.shift).toBe(false);
    expect(deck.padMode).toBe("hot-cue");
    expect(deck.padModeAtNs).toBe(3_000_000n);
    expect(deck.padsDown).toEqual([1]);
  });

  it("records loop state with beat lengths from the beat-loop pads", () => {
    const model = new Flx4StateModel();
    feed(model, [
      [0x97, 0x63, 0x7f], // beat-loop pad 4: 2 beats
    ]);
    expect(model.snapshot().decks[1].loop).toEqual({
      active: true,
      lastAction: "beat-loop",
      lastAtNs: 2_000_000n,
      beatLength: 2,
      quality: "estimated",
    });
    feed(model, [
      [0x98, 0x60, 0x7f], // +SHIFT beat-loop pad 1: halve
    ], 10_000_000n);
    expect(model.snapshot().decks[1].loop.beatLength).toBe(1);
    expect(model.snapshot().decks[1].loop.lastAction).toBe("halve");
    feed(model, [
      [0x98, 0x64, 0x7f], // +SHIFT beat-loop pad 5: double
    ], 20_000_000n);
    expect(model.snapshot().decks[1].loop.beatLength).toBe(2);
    expect(model.snapshot().decks[1].loop.lastAction).toBe("double");
  });

  it("tracks loop in and out, exit, and reloop on the same button", () => {
    const model = new Flx4StateModel();
    feed(model, [
      [0x90, 0x10, 0x7f], // LOOP IN
      [0x90, 0x11, 0x7f], // LOOP OUT
      [0x90, 0x4d, 0x7f], // RELOOP/EXIT with the loop on: exit
      [0x90, 0x4d, 0x7f], // again with the loop off: reloop
    ]);
    const loop = model.snapshot().decks[1].loop;
    expect(loop.active).toBe(true);
    expect(loop.lastAction).toBe("reloop");
    feed(model, [
      [0x90, 0x50, 0x7f], // +SHIFT reloop and stop
    ], 10_000_000n);
    expect(model.snapshot().decks[1].loop.active).toBe(false);
    expect(model.snapshot().decks[1].loop.lastAction).toBe("exit");
  });

  it("keeps mixer state from 14-bit pairs", () => {
    const model = new Flx4StateModel();
    const centre = fourteenBit(0x40, 0x40) / FOURTEEN_BIT_STEPS;
    feed(model, [
      [0xb0, 0x13, 0x7f],
      [0xb0, 0x33, 0x7f], // channel fader deck 1 full
      [0xb1, 0x13, 0x40],
      [0xb1, 0x33, 0x40], // channel fader deck 2 centre
      [0xb6, 0x1f, 0x00],
      [0xb6, 0x3f, 0x00], // crossfader hard left
      [0xb0, 0x07, 0x40],
      [0xb0, 0x27, 0x40], // EQ high centre
      [0xb0, 0x0f, 0x00],
      [0xb0, 0x2f, 0x7f], // EQ low, MSB 0 and LSB 127
      [0x90, 0x54, 0x7f], // headphone cue deck 1
      [0x91, 0x54, 0x7f], // headphone cue deck 2
      [0x96, 0x63, 0x7f], // master cue
    ]);
    const snapshot = model.snapshot();
    expect(snapshot.decks[1].channelFader?.position).toBeCloseTo(1, 12);
    expect(snapshot.decks[2].channelFader?.position).toBeCloseTo(centre, 12);
    expect(snapshot.mixer.crossfader?.position).toBe(0);
    expect(snapshot.decks[1].eqHigh).toBeCloseTo(centre, 12);
    expect(snapshot.decks[1].eqLow).toBeCloseTo(127 / FOURTEEN_BIT_STEPS, 12);
    expect(snapshot.mixer.headCue).toEqual({ 1: true, 2: true });
  });

  it("hands out snapshots that do not alias the model", () => {
    const model = new Flx4StateModel();
    feed(model, [[0x90, 0x0b, 0x7f], [0xb0, 0x22, 0x45], [0xb0, 0x22, 0x3b]]);
    const first = model.snapshot();
    first.decks[1].play.on = false;
    first.decks[1].jog.reversals.push(1n);
    const second = model.snapshot();
    expect(second.decks[1].play.on).toBe(true);
    expect(second.decks[1].jog.reversals).toEqual(first.decks[1].jog.reversals.slice(0, 1));
  });
});

describe("flx4 tempo range fit", () => {
  const samplesFor = (rangePercent: number, positions: number[]): TempoFitSample[] =>
    positions.map((position) => ({ deck: 1, position, pitchPercent: pitchForPosition(position, rangePercent) }));

  it("recovers the range from a simulated provider within 0.5 percent", () => {
    const fit = new TempoRangeFit();
    for (const sample of samplesFor(10, [0.2, 0.35, 0.5, 0.62, 0.8, 0.95])) fit.add(sample);
    const result = fit.fit(1);
    expect(result).not.toBeNull();
    expect(Math.abs((result?.rangePercent ?? 0) - 10)).toBeLessThanOrEqual(0.5);
    expect(result?.samples).toBe(6);
    expect(result?.residualPercent ?? 1).toBeLessThanOrEqual(0.5);
    const resolved = resolveTempoRange("source", { deck: 1, atNs: 0n, ...(result as { rangePercent: number; samples: number; residualPercent: number }) });
    expect(resolved).toEqual({ percent: result?.rangePercent, source: "fit" });
  });

  it("refuses underdetermined and noisy samples", () => {
    const thin = new TempoRangeFit();
    thin.add({ deck: 1, position: 0.3, pitchPercent: -4 });
    thin.add({ deck: 1, position: 0.7, pitchPercent: 4 });
    expect(thin.fit(1)).toBeNull();
    const flat = new TempoRangeFit();
    for (const sample of samplesFor(10, [0.51, 0.52, 0.53, 0.54])) flat.add(sample);
    expect(flat.fit(1)).toBeNull();
    const noisy = new TempoRangeFit();
    for (const sample of samplesFor(10, [0.2, 0.4, 0.6, 0.8])) noisy.add({ ...sample, pitchPercent: sample.pitchPercent + 3 });
    expect(noisy.fit(1)).toBeNull();
  });

  it("resolves fixed settings and leaves source and wide to the fit", () => {
    expect(resolveTempoRange("6", null)).toEqual({ percent: 6, source: "setting" });
    expect(resolveTempoRange("10", null)).toEqual({ percent: 10, source: "setting" });
    expect(resolveTempoRange("16", null)).toEqual({ percent: 16, source: "setting" });
    expect(resolveTempoRange("source", null)).toEqual({ percent: null, source: "unknown" });
    expect(resolveTempoRange("wide", null)).toEqual({ percent: null, source: "unknown" });
    expect(resolveTempoRange("wide", { deck: 2, atNs: 5n, rangePercent: 12.4, samples: 8, residualPercent: 0.2 })).toEqual({ percent: 12.4, source: "fit" });
  });
});
