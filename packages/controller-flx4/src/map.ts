// FLX4 MIDI control map and decoder (T-FLX-02, spec 10, spec 11).
//
// Source of every constant below: Pioneer DJ / AlphaTheta
// "DDJ-FLX4 List of MIDI messages" (document E1, Ver 1.0, 2022), the MIDI-IN
// columns (status, Data 1, Data 2). Deck separation is the MIDI channel:
// deck 1 is channel 1 (status 0x90/0xB0), deck 2 is channel 2 (0x91/0xB1),
// mixer and effect rows are channel 7 (0xB6/0x96/0x94/0xB4), the pads are
// channels 8 to 11 (0x97 to 0x9A).
// Cross-check (facts only, study-only reference): the Mixxx community mapping
// `Pioneer-DDJ-FLX4.midi.xml` (GPL) was used to confirm control identities.
//
// The jog is relative: 0x40 is the centre, values above 0x41 clockwise and
// below 0x3F counterclockwise (the document's Data 2 column).
// High-resolution controls send a 14-bit pair: MSB first, then LSB
// (`(msb << 7) | lsb`, 0 to 16383), normalized to 0 to 1 here.

export type Flx4Deck = 1 | 2;

export type Flx4ControlGroup = "deck" | "mixer" | "effect" | "browse" | "pad";

export type Flx4PadMode =
  | "hot-cue"
  | "pad-fx-1"
  | "beat-jump"
  | "sampler"
  | "keyboard"
  | "pad-fx-2"
  | "beat-loop"
  | "key-shift";

export type Flx4ControlKind = "button" | "cc" | "cc14-msb" | "cc14-lsb" | "jog" | "touch";

export interface Flx4ControlDef {
  /** Stable identifier, e.g. `deck1.play`, `mixer.crossfader`, `deck2.pad.hot-cue.3`. */
  id: string;
  /** Name from the official list (deck suffix stripped). */
  name: string;
  group: Flx4ControlGroup;
  deck: Flx4Deck | null;
  kind: Flx4ControlKind;
  /** Full status byte including the channel, as received. */
  status: number;
  /** Note or CC number (Data 1). */
  data1: number;
  /** True for the +SHIFT layer of the control. */
  shift: boolean;
  /** Set on pad and pad-mode entries. */
  padMode?: Flx4PadMode;
  /** 1 to 8 for pad entries. */
  padIndex?: number;
}

// --- status byte helpers ---------------------------------------------------

export const DECK_NOTE_STATUS: Record<Flx4Deck, number> = { 1: 0x90, 2: 0x91 };
export const DECK_CC_STATUS: Record<Flx4Deck, number> = { 1: 0xb0, 2: 0xb1 };
export const MIXER_CC_STATUS = 0xb6;
export const MIXER_NOTE_STATUS = 0x96;
export const EFFECT_FX1_STATUS = 0x94;
export const EFFECT_FX2_STATUS = 0x95;
export const EFFECT_LEVEL_STATUS = 0xb4;
export const PAD_STATUS: Record<Flx4Deck, readonly [number, number]> = {
  1: [0x97, 0x98],
  2: [0x99, 0x9a],
};

/** Pad Data 1 bases per mode, from the official list (pad 1 = base). */
export const PAD_MODE_BASE: Record<Flx4PadMode, number> = {
  "hot-cue": 0x00,
  "pad-fx-1": 0x10,
  "beat-jump": 0x20,
  sampler: 0x30,
  keyboard: 0x40,
  "pad-fx-2": 0x50,
  "beat-loop": 0x60,
  "key-shift": 0x70,
};

/** Note (Data 1) of each pad-mode key, per deck; the shift row is the second value. */
const PAD_MODE_KEYS: ReadonlyArray<{ mode: Flx4PadMode; note: number; shiftNote: number | null; shiftMode: Flx4PadMode | null }> = [
  { mode: "hot-cue", note: 0x1b, shiftNote: 0x69, shiftMode: "keyboard" },
  { mode: "pad-fx-1", note: 0x1e, shiftNote: 0x6b, shiftMode: "pad-fx-2" },
  { mode: "beat-jump", note: 0x20, shiftNote: 0x6d, shiftMode: "beat-loop" },
  { mode: "sampler", note: 0x22, shiftNote: 0x6f, shiftMode: "key-shift" },
];

/** Beat length of each beat-loop pad, pads 1 to 8 (`PAD 1` is a 1/4 loop). */
export const BEAT_LOOP_PAD_BEATS: readonly number[] = [0.25, 0.5, 1, 2, 4, 8, 16, 32];

/** Beat jump distance of each beat-jump pad (negative is backwards). */
export const BEAT_JUMP_PAD_BEATS: readonly number[] = [-1, 1, -2, 2, -4, 4, -8, 8];

const deckControls = (deck: Flx4Deck): Flx4ControlDef[] => {
  const note = DECK_NOTE_STATUS[deck];
  const cc = DECK_CC_STATUS[deck];
  const prefix = `deck${deck}`;
  const def = (
    id: string,
    name: string,
    kind: Flx4ControlKind,
    status: number,
    data1: number,
    shift = false,
  ): Flx4ControlDef => ({ id, name, group: "deck", deck, kind, status, data1, shift });
  const rows: Flx4ControlDef[] = [
    def(`${prefix}.play`, "PLAY/PAUSE", "button", note, 0x0b),
    def(`${prefix}.play`, "PLAY/PAUSE +SHIFT (censor)", "button", note, 0x0e, true),
    def(`${prefix}.cue`, "CUE", "button", note, 0x0c),
    def(`${prefix}.cue`, "CUE +SHIFT (track start)", "button", note, 0x48, true),
    def(`${prefix}.shift`, "SHIFT", "button", note, 0x3f),
    def(`${prefix}.jog.platter`, "JOG DIAL (platter, vinyl on)", "jog", cc, 0x22),
    def(`${prefix}.jog.platter-pitch`, "JOG DIAL (platter, vinyl off)", "jog", cc, 0x23),
    def(`${prefix}.jog.search`, "JOG DIAL (platter, search)", "jog", cc, 0x29, true),
    def(`${prefix}.jog.wheel`, "JOG DIAL (wheel side)", "jog", cc, 0x21),
    def(`${prefix}.jog.touch`, "JOG DIAL (platter touch)", "touch", note, 0x36),
    def(`${prefix}.jog.touch-shift`, "JOG DIAL (platter touch, high speed)", "touch", note, 0x67, true),
    def(`${prefix}.tempo`, "TEMPO MSB", "cc14-msb", cc, 0x00),
    def(`${prefix}.tempo`, "TEMPO LSB", "cc14-lsb", cc, 0x20),
    def(`${prefix}.sync`, "BEAT SYNC", "button", note, 0x58),
    def(`${prefix}.sync-master`, "BEAT SYNC (long press, set master)", "button", note, 0x5c),
    def(`${prefix}.sync-range`, "BEAT SYNC +SHIFT (tempo range)", "button", note, 0x60, true),
    def(`${prefix}.loop-in`, "LOOP IN / 4 BEAT", "button", note, 0x10),
    def(`${prefix}.loop-in-adjust`, "LOOP IN +SHIFT (adjust)", "button", note, 0x4c, true),
    def(`${prefix}.loop-out`, "LOOP OUT", "button", note, 0x11),
    def(`${prefix}.loop-out-adjust`, "LOOP OUT +SHIFT (adjust)", "button", note, 0x4e, true),
    def(`${prefix}.loop-exit`, "4 BEAT / RELOOP / EXIT", "button", note, 0x4d),
    def(`${prefix}.loop-exit-shift`, "4 BEAT / EXIT +SHIFT (reloop and stop)", "button", note, 0x50, true),
    def(`${prefix}.loop-halve`, "CUE/LOOP CALL (halve active loop)", "button", note, 0x51),
    def(`${prefix}.loop-halve-shift`, "CUE/LOOP CALL +SHIFT (quick jump back)", "button", note, 0x3e, true),
    def(`${prefix}.loop-double`, "CUE/LOOP CALL (double active loop)", "button", note, 0x53),
    def(`${prefix}.loop-double-shift`, "CUE/LOOP CALL +SHIFT (quick jump forward)", "button", note, 0x3d, true),
    def(`${prefix}.fader-start.play`, "CH FADER start (play message)", "button", note, 0x66),
    def(`${prefix}.fader-start.cue`, "CH FADER start (cue message)", "button", note, 0x52),
  ];
  for (const { mode, note: modeNote, shiftNote, shiftMode } of PAD_MODE_KEYS) {
    rows.push({ id: `${prefix}.pad-mode.${mode}`, name: `${mode} mode`, group: "deck", deck, kind: "button", status: note, data1: modeNote, shift: false, padMode: mode });
    if (shiftNote !== null && shiftMode !== null) {
      rows.push({ id: `${prefix}.pad-mode.${shiftMode}`, name: `${shiftMode} mode +SHIFT`, group: "deck", deck, kind: "button", status: note, data1: shiftNote, shift: true, padMode: shiftMode });
    }
  }
  return rows;
};

const padControls = (deck: Flx4Deck): Flx4ControlDef[] => {
  const [plain, shifted] = PAD_STATUS[deck];
  const rows: Flx4ControlDef[] = [];
  for (const [mode, base] of Object.entries(PAD_MODE_BASE) as Array<[Flx4PadMode, number]>) {
    for (let pad = 1; pad <= 8; pad += 1) {
      const data1 = base + pad - 1;
      rows.push({ id: `deck${deck}.pad.${mode}.${pad}`, name: `${mode} pad ${pad}`, group: "pad", deck, kind: "button", status: plain, data1, shift: false, padMode: mode, padIndex: pad });
      rows.push({ id: `deck${deck}.pad.${mode}.${pad}`, name: `${mode} pad ${pad} +SHIFT`, group: "pad", deck, kind: "button", status: shifted, data1, shift: true, padMode: mode, padIndex: pad });
    }
  }
  return rows;
};

const mixerControls = (): Flx4ControlDef[] => {
  const cc = MIXER_CC_STATUS;
  const note = MIXER_NOTE_STATUS;
  const def = (id: string, name: string, kind: Flx4ControlKind, status: number, data1: number, deck: Flx4Deck | null = null, shift = false): Flx4ControlDef => ({ id, name, group: "mixer", deck, kind, status, data1, shift });
  const rows: Flx4ControlDef[] = [
    def("mixer.master-level", "MASTER LEVEL MSB", "cc14-msb", cc, 0x08),
    def("mixer.master-level", "MASTER LEVEL LSB", "cc14-lsb", cc, 0x28),
    def("mixer.master-cue", "MASTER CUE", "button", note, 0x63),
    def("mixer.master-cue-shift", "MASTER CUE +SHIFT", "button", note, 0x78, null, true),
    def("mixer.head-mix", "HEADPHONE MIX MSB", "cc14-msb", cc, 0x0c),
    def("mixer.head-mix", "HEADPHONE MIX LSB", "cc14-lsb", cc, 0x2c),
    def("mixer.head-level", "HEADPHONE LEVEL MSB", "cc14-msb", cc, 0x0d),
    def("mixer.head-level", "HEADPHONE LEVEL LSB", "cc14-lsb", cc, 0x2d),
    def("mixer.mic-level", "MIC LEVEL MSB", "cc14-msb", cc, 0x05),
    def("mixer.mic-level", "MIC LEVEL LSB", "cc14-lsb", cc, 0x25),
    def("mixer.smart-cfx", "SMART CFX", "button", note, 0x00),
    def("mixer.smart-cfx-shift", "SMART CFX +SHIFT", "button", note, 0x08, null, true),
    def("mixer.smart-fader", "SMART FADER", "button", note, 0x01),
    def("mixer.smart-fader-shift", "SMART FADER +SHIFT", "button", note, 0x09, null, true),
    def("mixer.android-mode", "ANDROID MONO/STEREO", "button", note, 0x6d),
    def("mixer.crossfader", "CROSSFADER MSB", "cc14-msb", cc, 0x1f),
    def("mixer.crossfader", "CROSSFADER LSB", "cc14-lsb", cc, 0x3f),
  ];
  for (const deck of [1, 2] as const) {
    const deckCc = DECK_CC_STATUS[deck];
    const deckNote = DECK_NOTE_STATUS[deck];
    const prefix = `mixer.deck${deck}`;
    rows.push(
      def(`${prefix}.trim`, "TRIM MSB", "cc14-msb", deckCc, 0x04, deck),
      def(`${prefix}.trim`, "TRIM LSB", "cc14-lsb", deckCc, 0x24, deck),
      def(`${prefix}.eq-high`, "EQ HI MSB", "cc14-msb", deckCc, 0x07, deck),
      def(`${prefix}.eq-high`, "EQ HI LSB", "cc14-lsb", deckCc, 0x27, deck),
      def(`${prefix}.eq-mid`, "EQ MID MSB", "cc14-msb", deckCc, 0x0b, deck),
      def(`${prefix}.eq-mid`, "EQ MID LSB", "cc14-lsb", deckCc, 0x2b, deck),
      def(`${prefix}.eq-low`, "EQ LOW MSB", "cc14-msb", deckCc, 0x0f, deck),
      def(`${prefix}.eq-low`, "EQ LOW LSB", "cc14-lsb", deckCc, 0x2f, deck),
      def(`${prefix}.channel-fader`, "CH FADER MSB", "cc14-msb", deckCc, 0x13, deck),
      def(`${prefix}.channel-fader`, "CH FADER LSB", "cc14-lsb", deckCc, 0x33, deck),
      def(`${prefix}.cfx`, "CFX (colour filter) MSB", "cc14-msb", cc, deck === 1 ? 0x17 : 0x18, deck),
      def(`${prefix}.cfx`, "CFX (colour filter) LSB", "cc14-lsb", cc, deck === 1 ? 0x37 : 0x38, deck),
      def(`${prefix}.head-cue`, "CH CUE (headphone cue)", "button", deckNote, 0x54, deck),
      def(`${prefix}.head-cue-shift`, "CH CUE +SHIFT", "button", deckNote, 0x68, deck, true),
    );
  }
  return rows;
};

const effectControls = (): Flx4ControlDef[] => [
  { id: "fx.ch-select.1", name: "FX CH SELECT CH1", group: "effect", deck: null, kind: "button", status: EFFECT_FX1_STATUS, data1: 0x10, shift: false },
  { id: "fx.ch-select.2", name: "FX CH SELECT CH2", group: "effect", deck: null, kind: "button", status: EFFECT_FX1_STATUS, data1: 0x11, shift: false },
  { id: "fx.ch-select.1", name: "FX CH SELECT CH1 (second slider position)", group: "effect", deck: null, kind: "button", status: EFFECT_FX2_STATUS, data1: 0x10, shift: false },
  { id: "fx.ch-select.2", name: "FX CH SELECT CH2 (second slider position)", group: "effect", deck: null, kind: "button", status: EFFECT_FX2_STATUS, data1: 0x11, shift: false },
  { id: "fx.select", name: "FX SELECT", group: "effect", deck: null, kind: "button", status: EFFECT_FX1_STATUS, data1: 0x63, shift: false },
  { id: "fx.select", name: "FX SELECT +SHIFT", group: "effect", deck: null, kind: "button", status: EFFECT_FX1_STATUS, data1: 0x64, shift: true },
  { id: "fx.beat-left", name: "BEAT <", group: "effect", deck: null, kind: "button", status: EFFECT_FX1_STATUS, data1: 0x4a, shift: false },
  { id: "fx.beat-left", name: "BEAT < +SHIFT", group: "effect", deck: null, kind: "button", status: EFFECT_FX1_STATUS, data1: 0x66, shift: true },
  { id: "fx.beat-right", name: "BEAT >", group: "effect", deck: null, kind: "button", status: EFFECT_FX1_STATUS, data1: 0x4b, shift: false },
  { id: "fx.beat-right", name: "BEAT > +SHIFT", group: "effect", deck: null, kind: "button", status: EFFECT_FX1_STATUS, data1: 0x6b, shift: true },
  { id: "fx.on-off.1", name: "FX ON/OFF (CH1)", group: "effect", deck: 1, kind: "button", status: EFFECT_FX1_STATUS, data1: 0x47, shift: false },
  { id: "fx.on-off.2", name: "FX ON/OFF (CH2)", group: "effect", deck: 2, kind: "button", status: EFFECT_FX2_STATUS, data1: 0x47, shift: false },
  { id: "fx.on-off.1", name: "FX ON/OFF (CH1) +SHIFT", group: "effect", deck: 1, kind: "button", status: EFFECT_FX1_STATUS, data1: 0x43, shift: true },
  { id: "fx.on-off.2", name: "FX ON/OFF (CH2) +SHIFT", group: "effect", deck: 2, kind: "button", status: EFFECT_FX2_STATUS, data1: 0x43, shift: true },
  { id: "fx.level-depth", name: "LEVEL/DEPTH MSB", group: "effect", deck: null, kind: "cc14-msb", status: EFFECT_LEVEL_STATUS, data1: 0x02, shift: false },
  { id: "fx.level-depth", name: "LEVEL/DEPTH LSB", group: "effect", deck: null, kind: "cc14-lsb", status: EFFECT_LEVEL_STATUS, data1: 0x22, shift: false },
];

const browseControls = (): Flx4ControlDef[] => [
  { id: "browse.rotate", name: "BROWSE (rotate)", group: "browse", deck: null, kind: "jog", status: MIXER_CC_STATUS, data1: 0x40, shift: false },
  { id: "browse.rotate", name: "BROWSE (rotate) +SHIFT", group: "browse", deck: null, kind: "jog", status: MIXER_CC_STATUS, data1: 0x64, shift: true },
  { id: "browse.press", name: "BROWSE (press)", group: "browse", deck: null, kind: "button", status: MIXER_NOTE_STATUS, data1: 0x41, shift: false },
  { id: "browse.press", name: "BROWSE (press) +SHIFT", group: "browse", deck: null, kind: "button", status: MIXER_NOTE_STATUS, data1: 0x42, shift: true },
  { id: "browse.load.1", name: "LOAD (deck 1)", group: "browse", deck: 1, kind: "button", status: MIXER_NOTE_STATUS, data1: 0x46, shift: false },
  { id: "browse.load.1", name: "LOAD (deck 1) +SHIFT", group: "browse", deck: 1, kind: "button", status: MIXER_NOTE_STATUS, data1: 0x68, shift: true },
  { id: "browse.load.2", name: "LOAD (deck 2)", group: "browse", deck: 2, kind: "button", status: MIXER_NOTE_STATUS, data1: 0x47, shift: false },
  { id: "browse.load.2", name: "LOAD (deck 2) +SHIFT", group: "browse", deck: 2, kind: "button", status: MIXER_NOTE_STATUS, data1: 0x7a, shift: true },
];

export const FLX4_CONTROLS: readonly Flx4ControlDef[] = [
  ...deckControls(1),
  ...deckControls(2),
  ...padControls(1),
  ...padControls(2),
  ...mixerControls(),
  ...effectControls(),
  ...browseControls(),
];

/** Static lookup table keyed `status:data1`, the pair that identifies a control. */
export const FLX4_CONTROL_INDEX: Readonly<Record<string, Flx4ControlDef>> = Object.fromEntries(
  FLX4_CONTROLS.map((control) => [`${control.status}:${control.data1}`, control]),
);

export function controlFor(status: number, data1: number): Flx4ControlDef | undefined {
  return FLX4_CONTROL_INDEX[`${status & 0xff}:${data1 & 0x7f}`];
}

// --- decoder ---------------------------------------------------------------

export interface Flx4RawMessage {
  status: number;
  data1: number;
  data2: number;
  receivedAtNs: bigint;
}

export interface Flx4ControlEvent {
  type: "control";
  id: string;
  name: string;
  group: Flx4ControlGroup;
  deck: Flx4Deck | null;
  kind: Flx4ControlKind;
  shift: boolean;
  padMode?: Flx4PadMode;
  padIndex?: number;
  /** Normalized value: 0 to 1 for continuous controls, 0 or 1 for buttons, jog delta for jogs. */
  value: number;
  /** Button down / touch contact. */
  on: boolean;
  /** False when a 14-bit MSB or LSB arrived without its partner. */
  complete: boolean;
  raw: readonly [number, number, number];
  receivedAtNs: bigint;
}

export interface Flx4UnknownEvent {
  type: "unknown";
  raw: readonly [number, number, number];
  receivedAtNs: bigint;
}

export type Flx4Event = Flx4ControlEvent | Flx4UnknownEvent;

/** Jog centre per the official list: 0x40 is no movement. */
export const JOG_CENTER = 0x40;

export class Flx4Decoder {
  private readonly msb = new Map<string, number>();
  private unknown = 0;

  get unknownCount(): number {
    return this.unknown;
  }

  /** Decodes one 3-byte MIDI message. Unknown messages are counted, never dropped. */
  decode(message: Flx4RawMessage): Flx4Event {
    const { status, data1, data2, receivedAtNs } = message;
    const raw = [status & 0xff, data1 & 0x7f, data2 & 0x7f] as const;
    const control = controlFor(status & 0xff, data1 & 0x7f);
    if (control === undefined) {
      this.unknown += 1;
      return { type: "unknown", raw, receivedAtNs };
    }
    const base = {
      type: "control" as const,
      id: control.id,
      name: control.name,
      group: control.group,
      deck: control.deck,
      kind: control.kind,
      shift: control.shift,
      raw,
      receivedAtNs,
      ...(control.padMode !== undefined ? { padMode: control.padMode } : {}),
      ...(control.padIndex !== undefined ? { padIndex: control.padIndex } : {}),
    };
    switch (control.kind) {
      case "button":
      case "touch":
        return { ...base, value: data2 > 0 ? 1 : 0, on: data2 > 0, complete: true };
      case "jog":
        return { ...base, value: data2 - JOG_CENTER, on: data2 !== JOG_CENTER, complete: true };
      case "cc":
        return { ...base, value: data2 / 127, on: data2 > 0, complete: true };
      case "cc14-msb": {
        this.msb.set(`${status & 0xff}:${data1 & 0x7f}`, data2 & 0x7f);
        return { ...base, value: (data2 & 0x7f) / 127, on: false, complete: false };
      }
      case "cc14-lsb": {
        const msb = this.msb.get(`${status & 0xff}:${data1 - 0x20}`);
        if (msb === undefined) {
          return { ...base, value: (data2 & 0x7f) / 16383, on: false, complete: false };
        }
        this.msb.delete(`${status & 0xff}:${data1 - 0x20}`);
        return { ...base, value: ((msb << 7) | (data2 & 0x7f)) / 16383, on: false, complete: true };
      }
    }
  }

  /** Decodes a raw byte array; arrays shorter than three bytes are unknown. */
  decodeBytes(bytes: readonly number[], receivedAtNs: bigint): Flx4Event {
    const status = bytes[0];
    const data1 = bytes[1];
    const data2 = bytes[2];
    if (status === undefined || data1 === undefined || data2 === undefined) {
      this.unknown += 1;
      return { type: "unknown", raw: [status ?? 0, data1 ?? 0, data2 ?? 0], receivedAtNs };
    }
    return this.decode({ status, data1, data2, receivedAtNs });
  }
}

/** One-shot decode for callers that do not keep the 14-bit pairing state. */
export function decodeMessage(message: Flx4RawMessage, decoder = new Flx4Decoder()): Flx4Event {
  return decoder.decode(message);
}

/** Reconstructs a 14-bit value from a pair (the official list's MSB then LSB order). */
export function fourteenBit(msb: number, lsb: number): number {
  return ((msb & 0x7f) << 7) | (lsb & 0x7f);
}

/** Number of 14-bit steps, for normalizing a pair to 0 to 1. */
export const FOURTEEN_BIT_STEPS = 16383;
