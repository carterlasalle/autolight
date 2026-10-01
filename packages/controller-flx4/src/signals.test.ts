// T-FLX-04: runtime signal tests driven by captured sequences.

import { describe, expect, it } from "vitest";
import { Flx4Decoder } from "./map.js";
import { Flx4SignalDeriver, type Flx4Signal } from "./signals.js";
import { Flx4StateModel } from "./state.js";

type Row = readonly [status: number, data1: number, data2: number];

function run(rows: readonly Row[], opts: { djSoftware?: "rekordbox" | "serato" | null } = {}): Flx4Signal[] {
  const decoder = new Flx4Decoder();
  const model = new Flx4StateModel();
  const deriver = new Flx4SignalDeriver(opts);
  const signals: Flx4Signal[] = [];
  let atNs = 1_000_000n;
  for (const [status, data1, data2] of rows) {
    atNs += 10_000_000n;
    const event = decoder.decode({ status, data1, data2, receivedAtNs: atNs });
    model.apply(event);
    signals.push(...deriver.derive(event, model.snapshot()));
  }
  return signals;
}

const kinds = (signals: Flx4Signal[]): string[] => signals.map((signal) => signal.kind);

describe("flx4 runtime signals", () => {
  it("raises a scratch only for a jog trace with reversals", () => {
    const scratch = run([
      [0x90, 0x0b, 0x7f], // PLAY
      [0x90, 0x36, 0x7f], // touch
      [0xb0, 0x22, 0x45], // forward
      [0xb0, 0x22, 0x3b], // reversal 1
      [0xb0, 0x22, 0x45], // reversal 2
      [0x90, 0x36, 0x00], // release
    ]);
    const start = scratch.find((signal) => signal.kind === "scratch-start");
    const end = scratch.find((signal) => signal.kind === "scratch-end");
    expect(start).toBeDefined();
    expect(end).toBeDefined();
    expect(kinds(scratch)).toEqual(["scratch-start", "scratch-end"]);
    if (start !== undefined && start.kind === "scratch-start") {
      expect(start.deck).toBe(1);
      expect(start.quality).toBe("estimated");
      expect(start.source).toBe("controller");
      expect(start.reversalNs).toHaveLength(2);
      expect(start.reversalNs.every((ns) => typeof ns === "bigint")).toBe(true);
    }
  });

  it("does not claim a scratch from a single reversal or a steady reverse", () => {
    const single = run([
      [0x90, 0x36, 0x7f],
      [0xb0, 0x22, 0x45],
      [0xb0, 0x22, 0x3b],
    ]);
    expect(kinds(single)).toEqual([]);
    const steady = run([
      [0x90, 0x36, 0x7f],
      [0xb0, 0x22, 0x3b],
      [0xb0, 0x22, 0x3b],
      [0xb0, 0x22, 0x3b],
    ]);
    expect(kinds(steady)).toEqual([]);
  });

  it("emits the runtime scratch trace with reversal timestamps", () => {
    const decoder = new Flx4Decoder();
    const model = new Flx4StateModel();
    const deriver = new Flx4SignalDeriver();
    let atNs = 1_000_000n;
    for (const [status, data1, data2] of [
      [0x90, 0x36, 0x7f],
      [0xb0, 0x22, 0x45],
      [0xb0, 0x22, 0x3b],
      [0xb0, 0x22, 0x45],
    ] as Row[]) {
      atNs += 10_000_000n;
      model.apply(decoder.decode({ status, data1, data2, receivedAtNs: atNs }));
    }
    const trace = deriver.scratchTrace(model.snapshot(), 1);
    expect(trace.active).toBe(true);
    expect(trace.direction).toBe(1);
    expect(trace.reversalNs).toEqual([31_000_000n, 41_000_000n]);
  });

  it("carries cue holds, hot cues and pad rolls with their pad numbers", () => {
    const signals = run([
      [0x90, 0x0c, 0x7f],
      [0x90, 0x0c, 0x00],
      [0x97, 0x00, 0x7f], // hot cue pad 1
      [0x97, 0x02, 0x7f], // hot cue pad 3
    ]);
    expect(kinds(signals)).toEqual(["cue-hold", "cue-hold", "hot-cue", "hot-cue"]);
    expect(signals[2]).toMatchObject({ kind: "hot-cue", deck: 1, padIndex: 1, quality: "observed" });
    const roll = run([
      [0x97, 0x51, 0x7f], // PAD FX 2 (Serato Roll) pad 2 down
      [0x97, 0x51, 0x00],
    ], { djSoftware: "serato" });
    expect(roll).toMatchObject([
      { kind: "pad-roll-start", deck: 1, padIndex: 2, beats: null, quality: "estimated" },
      { kind: "pad-roll-stop", deck: 1, padIndex: 2 },
    ]);
    const rekordbox = run([
      [0x97, 0x51, 0x7f],
    ], { djSoftware: "rekordbox" });
    expect(kinds(rekordbox)).toEqual(["pad-press"]);
  });

  it("carries loop, beat loop and beat jump lengths", () => {
    const signals = run([
      [0x90, 0x10, 0x7f], // loop in
      [0x90, 0x11, 0x7f], // loop out
      [0x97, 0x65, 0x7f], // beat-loop pad 6: 8 beats
      [0x98, 0x62, 0x7f], // +SHIFT pad 3: halve
      [0x98, 0x66, 0x7f], // +SHIFT pad 7: double
      [0x90, 0x4d, 0x7f], // exit
      [0x90, 0x51, 0x7f], // call left: halve active loop
      [0x90, 0x53, 0x7f], // call right: double active loop
      [0x97, 0x21, 0x7f], // beat-jump pad 2: 1 beat forward
      [0x98, 0x27, 0x7f], // +SHIFT pad 8: 8 beats times 16
    ]);
    expect(kinds(signals)).toEqual([
      "loop-in",
      "loop-out",
      "beat-loop",
      "loop-halve",
      "loop-double",
      "loop-exit",
      "loop-halve",
      "loop-double",
      "beat-jump",
      "beat-jump",
    ]);
    expect(signals[2]).toMatchObject({ kind: "beat-loop", padIndex: 6, beats: 8 });
    expect(signals[8]).toMatchObject({ kind: "beat-jump", beats: 1 });
    expect(signals[9]).toMatchObject({ kind: "beat-jump", beats: 128 });
    expect(signals[5]).toMatchObject({ kind: "loop-exit", beats: null });
  });

  it("reloops through the same button when the loop is off", () => {
    const signals = run([
      [0x90, 0x10, 0x7f],
      [0x90, 0x4d, 0x7f],
      [0x90, 0x4d, 0x7f],
    ]);
    expect(kinds(signals)).toEqual(["loop-in", "loop-exit", "reloop"]);
  });

  it("publishes sync toggles, faders and loads as secondary truth", () => {
    const signals = run([
      [0x90, 0x58, 0x7f], // BEAT SYNC
      [0x90, 0x5c, 0x7f], // long press: master
      [0xb0, 0x13, 0x40],
      [0xb0, 0x33, 0x00], // channel fader deck 1 centre
      [0xb6, 0x1f, 0x00],
      [0xb6, 0x3f, 0x00], // crossfader left
      [0x96, 0x46, 0x7f], // LOAD deck 1
    ]);
    expect(kinds(signals)).toEqual(["sync", "sync", "fader", "crossfader", "load"]);
    expect(signals[0]).toMatchObject({ kind: "sync", on: true, master: false, quality: "estimated" });
    expect(signals[1]).toMatchObject({ kind: "sync", on: true, master: true });
    expect(signals[2]).toMatchObject({ kind: "fader", deck: 1, quality: "observed" });
    if (signals[2] !== undefined && signals[2].kind === "fader") expect(signals[2].value).toBeCloseTo(8192 / 16383, 12);
    expect(signals[3]).toMatchObject({ kind: "crossfader", value: 0, quality: "observed" });
    expect(signals[4]).toMatchObject({ kind: "load", deck: 1 });
  });

  it("marks the deck for deck 2 pads and faders", () => {
    const signals = run([
      [0x99, 0x01, 0x7f], // deck 2 hot cue pad 2
      [0xb1, 0x13, 0x7f],
      [0xb1, 0x33, 0x7f], // deck 2 channel fader full
    ]);
    expect(signals[0]).toMatchObject({ kind: "hot-cue", deck: 2, padIndex: 2 });
    expect(signals[1]).toMatchObject({ kind: "fader", deck: 2 });
    if (signals[1] !== undefined && signals[1].kind === "fader") expect(signals[1].value).toBeCloseTo(1, 12);
  });
});
