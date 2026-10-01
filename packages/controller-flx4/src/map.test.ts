// P-11-flx4-map (T-FLX-02): decoder over the committed capture of every
// control, asserting deck and control for each.
//
// The literal rows below are the official list's MIDI-IN columns (status,
// Data 1) transcribed per group. They are independent of ./map.ts: a wrong
// constant in the map makes this test red.

import { describe, expect, it } from "vitest";
import { FLX4_CONTROLS, FOURTEEN_BIT_STEPS, Flx4Decoder, fourteenBit, type Flx4ControlKind } from "./map.js";

interface Row {
  status: number;
  data1: number;
  id: string;
  deck: 1 | 2 | null;
  shift: boolean;
  kind: Flx4ControlKind;
  padMode?: string;
  padIndex?: number;
}

const NOTE_STATUS = { 1: 0x90, 2: 0x91 } as const;
const CC_STATUS = { 1: 0xb0, 2: 0xb1 } as const;
const PAD_STATUS = { 1: [0x97, 0x98], 2: [0x99, 0x9a] } as const;

// Group 1, DECK, per deck channel.
const DECK_LIST: ReadonlyArray<{ data1: number; id: string; shift: boolean; kind: Flx4ControlKind }> = [
  { data1: 0x0b, id: "play", shift: false, kind: "button" },
  { data1: 0x0e, id: "play", shift: true, kind: "button" },
  { data1: 0x0c, id: "cue", shift: false, kind: "button" },
  { data1: 0x48, id: "cue", shift: true, kind: "button" },
  { data1: 0x3f, id: "shift", shift: false, kind: "button" },
  { data1: 0x22, id: "jog.platter", shift: false, kind: "jog" },
  { data1: 0x23, id: "jog.platter-pitch", shift: false, kind: "jog" },
  { data1: 0x29, id: "jog.search", shift: true, kind: "jog" },
  { data1: 0x21, id: "jog.wheel", shift: false, kind: "jog" },
  { data1: 0x36, id: "jog.touch", shift: false, kind: "touch" },
  { data1: 0x67, id: "jog.touch-shift", shift: true, kind: "touch" },
  { data1: 0x00, id: "tempo", shift: false, kind: "cc14-msb" },
  { data1: 0x20, id: "tempo", shift: false, kind: "cc14-lsb" },
  { data1: 0x58, id: "sync", shift: false, kind: "button" },
  { data1: 0x5c, id: "sync-master", shift: false, kind: "button" },
  { data1: 0x60, id: "sync-range", shift: true, kind: "button" },
  { data1: 0x10, id: "loop-in", shift: false, kind: "button" },
  { data1: 0x4c, id: "loop-in-adjust", shift: true, kind: "button" },
  { data1: 0x11, id: "loop-out", shift: false, kind: "button" },
  { data1: 0x4e, id: "loop-out-adjust", shift: true, kind: "button" },
  { data1: 0x4d, id: "loop-exit", shift: false, kind: "button" },
  { data1: 0x50, id: "loop-exit-shift", shift: true, kind: "button" },
  { data1: 0x51, id: "loop-halve", shift: false, kind: "button" },
  { data1: 0x3e, id: "loop-halve-shift", shift: true, kind: "button" },
  { data1: 0x53, id: "loop-double", shift: false, kind: "button" },
  { data1: 0x3d, id: "loop-double-shift", shift: true, kind: "button" },
  { data1: 0x66, id: "fader-start.play", shift: false, kind: "button" },
  { data1: 0x52, id: "fader-start.cue", shift: false, kind: "button" },
  { data1: 0x1b, id: "pad-mode.hot-cue", shift: false, kind: "button" },
  { data1: 0x69, id: "pad-mode.keyboard", shift: true, kind: "button" },
  { data1: 0x1e, id: "pad-mode.pad-fx-1", shift: false, kind: "button" },
  { data1: 0x6b, id: "pad-mode.pad-fx-2", shift: true, kind: "button" },
  { data1: 0x20, id: "pad-mode.beat-jump", shift: false, kind: "button" },
  { data1: 0x6d, id: "pad-mode.beat-loop", shift: true, kind: "button" },
  { data1: 0x22, id: "pad-mode.sampler", shift: false, kind: "button" },
  { data1: 0x6f, id: "pad-mode.key-shift", shift: true, kind: "button" },
];

/** Pad Data 1 bases, Group 5 of the official list (pad 1 = base + 0). */
const PAD_BASES: ReadonlyArray<{ mode: string; base: number }> = [
  { mode: "hot-cue", base: 0x00 },
  { mode: "pad-fx-1", base: 0x10 },
  { mode: "beat-jump", base: 0x20 },
  { mode: "sampler", base: 0x30 },
  { mode: "keyboard", base: 0x40 },
  { mode: "pad-fx-2", base: 0x50 },
  { mode: "beat-loop", base: 0x60 },
  { mode: "key-shift", base: 0x70 },
];

/** Group 2 to 4: mixer, effect and browser rows. */
const PROW_ROWS: ReadonlyArray<{ status: number; data1: number; id: string; deck: 1 | 2 | null; kind: Flx4ControlKind; shift?: boolean }> = [
  { status: 0xb6, data1: 0x08, id: "mixer.master-level", deck: null, kind: "cc14-msb" },
  { status: 0xb6, data1: 0x28, id: "mixer.master-level", deck: null, kind: "cc14-lsb" },
  { status: 0x96, data1: 0x63, id: "mixer.master-cue", deck: null, kind: "button" },
  { status: 0x96, data1: 0x78, id: "mixer.master-cue-shift", deck: null, kind: "button", shift: true },
  { status: 0xb6, data1: 0x0c, id: "mixer.head-mix", deck: null, kind: "cc14-msb" },
  { status: 0xb6, data1: 0x2c, id: "mixer.head-mix", deck: null, kind: "cc14-lsb" },
  { status: 0xb6, data1: 0x0d, id: "mixer.head-level", deck: null, kind: "cc14-msb" },
  { status: 0xb6, data1: 0x2d, id: "mixer.head-level", deck: null, kind: "cc14-lsb" },
  { status: 0xb6, data1: 0x05, id: "mixer.mic-level", deck: null, kind: "cc14-msb" },
  { status: 0xb6, data1: 0x25, id: "mixer.mic-level", deck: null, kind: "cc14-lsb" },
  { status: 0x96, data1: 0x00, id: "mixer.smart-cfx", deck: null, kind: "button" },
  { status: 0x96, data1: 0x08, id: "mixer.smart-cfx-shift", deck: null, kind: "button", shift: true },
  { status: 0x96, data1: 0x01, id: "mixer.smart-fader", deck: null, kind: "button" },
  { status: 0x96, data1: 0x09, id: "mixer.smart-fader-shift", deck: null, kind: "button", shift: true },
  { status: 0x96, data1: 0x6d, id: "mixer.android-mode", deck: null, kind: "button" },
  { status: 0xb6, data1: 0x1f, id: "mixer.crossfader", deck: null, kind: "cc14-msb" },
  { status: 0xb6, data1: 0x3f, id: "mixer.crossfader", deck: null, kind: "cc14-lsb" },
  { status: 0x94, data1: 0x10, id: "fx.ch-select.1", deck: null, kind: "button" },
  { status: 0x94, data1: 0x11, id: "fx.ch-select.2", deck: null, kind: "button" },
  { status: 0x95, data1: 0x10, id: "fx.ch-select.1", deck: null, kind: "button" },
  { status: 0x95, data1: 0x11, id: "fx.ch-select.2", deck: null, kind: "button" },
  { status: 0x94, data1: 0x63, id: "fx.select", deck: null, kind: "button" },
  { status: 0x94, data1: 0x64, id: "fx.select", deck: null, kind: "button", shift: true },
  { status: 0x94, data1: 0x4a, id: "fx.beat-left", deck: null, kind: "button" },
  { status: 0x94, data1: 0x66, id: "fx.beat-left", deck: null, kind: "button", shift: true },
  { status: 0x94, data1: 0x4b, id: "fx.beat-right", deck: null, kind: "button" },
  { status: 0x94, data1: 0x6b, id: "fx.beat-right", deck: null, kind: "button", shift: true },
  { status: 0x94, data1: 0x47, id: "fx.on-off.1", deck: 1, kind: "button" },
  { status: 0x95, data1: 0x47, id: "fx.on-off.2", deck: 2, kind: "button" },
  { status: 0x94, data1: 0x43, id: "fx.on-off.1", deck: 1, kind: "button", shift: true },
  { status: 0x95, data1: 0x43, id: "fx.on-off.2", deck: 2, kind: "button", shift: true },
  { status: 0xb4, data1: 0x02, id: "fx.level-depth", deck: null, kind: "cc14-msb" },
  { status: 0xb4, data1: 0x22, id: "fx.level-depth", deck: null, kind: "cc14-lsb" },
  { status: 0xb6, data1: 0x40, id: "browse.rotate", deck: null, kind: "jog" },
  { status: 0xb6, data1: 0x64, id: "browse.rotate", deck: null, kind: "jog", shift: true },
  { status: 0x96, data1: 0x41, id: "browse.press", deck: null, kind: "button" },
  { status: 0x96, data1: 0x42, id: "browse.press", deck: null, kind: "button", shift: true },
  { status: 0x96, data1: 0x46, id: "browse.load.1", deck: 1, kind: "button" },
  { status: 0x96, data1: 0x68, id: "browse.load.1", deck: 1, kind: "button", shift: true },
  { status: 0x96, data1: 0x47, id: "browse.load.2", deck: 2, kind: "button" },
  { status: 0x96, data1: 0x7a, id: "browse.load.2", deck: 2, kind: "button", shift: true },
];

function allRows(): Row[] {
  const rows: Row[] = [];
  for (const deck of [1, 2] as const) {
    for (const item of DECK_LIST) {
      const isCc = item.kind === "jog" || item.kind.startsWith("cc14");
      rows.push({
        status: isCc ? CC_STATUS[deck] : NOTE_STATUS[deck],
        data1: item.data1,
        id: `deck${deck}.${item.id}`,
        deck,
        shift: item.shift,
        kind: item.kind,
      });
    }
    for (const { mode, base } of PAD_BASES) {
      for (let pad = 1; pad <= 8; pad += 1) {
        for (const shift of [false, true]) {
          const status = shift ? PAD_STATUS[deck][1] : PAD_STATUS[deck][0];
          rows.push({
            status,
            data1: base + pad - 1,
            id: `deck${deck}.pad.${mode}.${pad}`,
            deck,
            shift,
            kind: "button",
            padMode: mode,
            padIndex: pad,
          });
        }
      }
    }
    const cc = CC_STATUS[deck];
    const note = NOTE_STATUS[deck];
    const prefix = `deck${deck}`;
    const mixerRows: ReadonlyArray<{ status: number; data1: number; id: string; kind: Flx4ControlKind; shift?: boolean }> = [
      { status: cc, data1: 0x04, id: "trim", kind: "cc14-msb" },
      { status: cc, data1: 0x24, id: "trim", kind: "cc14-lsb" },
      { status: cc, data1: 0x07, id: "eq-high", kind: "cc14-msb" },
      { status: cc, data1: 0x27, id: "eq-high", kind: "cc14-lsb" },
      { status: cc, data1: 0x0b, id: "eq-mid", kind: "cc14-msb" },
      { status: cc, data1: 0x2b, id: "eq-mid", kind: "cc14-lsb" },
      { status: cc, data1: 0x0f, id: "eq-low", kind: "cc14-msb" },
      { status: cc, data1: 0x2f, id: "eq-low", kind: "cc14-lsb" },
      { status: cc, data1: 0x13, id: "channel-fader", kind: "cc14-msb" },
      { status: cc, data1: 0x33, id: "channel-fader", kind: "cc14-lsb" },
      { status: 0xb6, data1: deck === 1 ? 0x17 : 0x18, id: "cfx", kind: "cc14-msb" },
      { status: 0xb6, data1: deck === 1 ? 0x37 : 0x38, id: "cfx", kind: "cc14-lsb" },
      { status: note, data1: 0x54, id: "head-cue", kind: "button" },
      { status: note, data1: 0x68, id: "head-cue-shift", kind: "button", shift: true },
    ];
    for (const item of mixerRows) {
      rows.push({ status: item.status, data1: item.data1, id: `mixer.${prefix}.${item.id}`, deck, shift: item.shift ?? false, kind: item.kind });
    }
  }
  for (const item of PROW_ROWS) {
    rows.push({ status: item.status, data1: item.data1, id: item.id, deck: item.deck, shift: item.shift ?? false, kind: item.kind });
  }
  return rows;
}

describe("flx4 map (P-11-flx4-map)", () => {
  it("decodes every control of the capture with the right deck", () => {
    const decoder = new Flx4Decoder();
    let atNs = 0n;
    for (const row of allRows()) {
      atNs += 1_000_000n;
      const event = decoder.decode({ status: row.status, data1: row.data1, data2: 0x7f, receivedAtNs: atNs });
      expect(event.type, `${row.id} at ${row.status.toString(16)}:${row.data1.toString(16)}`).toBe("control");
      if (event.type !== "control") continue;
      const where = `${row.id} ${row.status.toString(16)}:${row.data1.toString(16)}`;
      expect(event.id, where).toBe(row.id);
      expect(event.deck, where).toBe(row.deck);
      expect(event.shift, where).toBe(row.shift);
      expect(event.kind, where).toBe(row.kind);
      if (row.padIndex !== undefined) expect(event.padIndex, where).toBe(row.padIndex);
      if (row.padMode !== undefined) expect(event.padMode, where).toBe(row.padMode);
    }
    expect(decoder.unknownCount).toBe(0);
  });

  it("covers the whole map: no control without a capture row", () => {
    const captured = new Set(allRows().map((row) => `${row.status}:${row.data1}:${row.id}:${row.shift}`));
    const missing = FLX4_CONTROLS.filter(
      (control) => !captured.has(`${control.status}:${control.data1}:${control.id}:${control.shift}`),
    ).map((control) => `${control.id} ${control.status.toString(16)}:${control.data1.toString(16)} shift=${control.shift}`);
    expect(missing).toEqual([]);
  });

  it("keeps unknown messages as events with raw bytes and counts them", () => {
    const decoder = new Flx4Decoder();
    const unknown = decoder.decode({ status: 0x90, data1: 0x7e, data2: 0x40, receivedAtNs: 5n });
    expect(unknown.type).toBe("unknown");
    if (unknown.type === "unknown") expect([...unknown.raw]).toEqual([0x90, 0x7e, 0x40]);
    const malformed = decoder.decodeBytes([0xb0], 6n);
    expect(malformed.type).toBe("unknown");
    expect(decoder.unknownCount).toBe(2);
    const known = decoder.decode({ status: 0x90, data1: 0x0b, data2: 0x7f, receivedAtNs: 7n });
    expect(known.type).toBe("control");
    expect(decoder.unknownCount).toBe(2);
  });

  it("reconstructs 14-bit pairs monotonically across the full travel", () => {
    const decoder = new Flx4Decoder();
    const continuous: ReadonlyArray<{ status: number; msb: number; lsb: number }> = [
      { status: 0xb0, msb: 0x00, lsb: 0x20 },
      { status: 0xb1, msb: 0x00, lsb: 0x20 },
      { status: 0xb0, msb: 0x13, lsb: 0x33 },
      { status: 0xb1, msb: 0x13, lsb: 0x33 },
      { status: 0xb6, msb: 0x1f, lsb: 0x3f },
      { status: 0xb0, msb: 0x04, lsb: 0x24 },
      { status: 0xb0, msb: 0x07, lsb: 0x27 },
      { status: 0xb6, msb: 0x17, lsb: 0x37 },
      { status: 0xb6, msb: 0x08, lsb: 0x28 },
      { status: 0xb4, msb: 0x02, lsb: 0x22 },
    ];
    for (const pair of continuous) {
      let previous = -1;
      let atNs = 0n;
      const steps: number[] = [];
      for (let value = 0; value < FOURTEEN_BIT_STEPS; value += 137) steps.push(value);
      steps.push(FOURTEEN_BIT_STEPS);
      for (const value of steps) {
        const msb = value >> 7;
        const lsb = value & 0x7f;
        atNs += 1_000n;
        const partial = decoder.decode({ status: pair.status, data1: pair.msb, data2: msb, receivedAtNs: atNs });
        expect(partial.type).toBe("control");
        if (partial.type === "control") expect(partial.complete).toBe(false);
        atNs += 1_000n;
        const event = decoder.decode({ status: pair.status, data1: pair.lsb, data2: lsb, receivedAtNs: atNs });
        expect(event.type).toBe("control");
        if (event.type !== "control") continue;
        expect(event.complete).toBe(true);
        const expected = fourteenBit(msb, lsb) / FOURTEEN_BIT_STEPS;
        expect(event.value).toBeCloseTo(expected, 12);
        expect(event.value).toBeGreaterThanOrEqual(previous);
        previous = event.value;
      }
      expect(previous).toBeCloseTo(1, 12);
    }
  });

  it("decodes the jog as a relative value around 0x40", () => {
    const decoder = new Flx4Decoder();
    const clockwise = decoder.decode({ status: 0xb0, data1: 0x22, data2: 0x41, receivedAtNs: 1n });
    const counter = decoder.decode({ status: 0xb0, data1: 0x22, data2: 0x3f, receivedAtNs: 2n });
    const centred = decoder.decode({ status: 0xb0, data1: 0x22, data2: 0x40, receivedAtNs: 3n });
    expect(clockwise.type === "control" && clockwise.value).toBe(1);
    expect(counter.type === "control" && counter.value).toBe(-1);
    expect(centred.type === "control" && centred.value).toBe(0);
    expect(centred.type === "control" && centred.on).toBe(false);
  });
});
