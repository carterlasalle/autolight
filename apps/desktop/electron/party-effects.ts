// Party effects: LED_PARTY's vendor-mode catalog (pulsating colours, strobes,
// rainbow jumps) re-created client-side over the razer stream, plus the
// engine's colour wash and single spot. Every effect is a pure function of a
// tick index, so frames are deterministic and testable without sockets; the
// manager's runner supplies the tick and the transport.
//
// The vendor opcodes in LED_PARTY drove HappyLighting chips; Govee units have
// no equivalent setter, so the same looks are produced by repainting zones.

import type { PartyPaletteName, PartyEffectName } from "@autolight/ipc";

export type Rgb = [number, number, number];

export type PartyEffect = PartyEffectName;

/** LED_PARTY PALETTES, ported verbatim; keys mirror
 *  @autolight/ipc's partyPaletteNames so the channel and this table can
 *  never drift. */
export const PARTY_PALETTES: Record<PartyPaletteName, Rgb[]> = {
  ND: [[12, 36, 150], [255, 200, 0], [255, 255, 255]],
  Warm: [[255, 120, 0], [255, 180, 120], [255, 40, 0], [255, 255, 255]],
  Cool: [[0, 180, 255], [0, 255, 150], [0, 80, 255], [255, 255, 255]],
  Neon: [[255, 0, 255], [0, 255, 255], [255, 0, 120], [255, 255, 255]],
  Fire: [[255, 0, 0], [255, 80, 0], [255, 160, 0], [255, 255, 100]],
  Ocean: [[0, 30, 180], [0, 120, 255], [0, 200, 200], [150, 220, 255]],
  UV: [[100, 0, 255], [180, 0, 255], [255, 0, 200], [255, 100, 255]],
};

const BLACK: Rgb = [0, 0, 0];

// Ticks per breath / wash cycle. With the 40..5000 ms speed range this keeps
// pulses and washes in a musical band (8 x 250 ms = 2 s).
const CYCLE = 8;

const blend = (from: Rgb, to: Rgb, k: number): Rgb => [
  Math.round(from[0] + (to[0] - from[0]) * k),
  Math.round(from[1] + (to[1] - from[1]) * k),
  Math.round(from[2] + (to[2] - from[2]) * k),
];

/**
 * Colours for `groups` outputs at `tick`. `groups` is one per fixture
 * (lamps mode) or two (strip halves). `a`/`b` are the operator's flash
 * colours; the palette drives pulse and jump.
 */
export function partyFrame(
  effect: PartyEffect,
  tick: number,
  opts: { groups: number; a: Rgb; b: Rgb; palette: Rgb[] },
): Rgb[] {
  const palette = opts.palette.length > 0 ? opts.palette : [opts.a, opts.b];
  const fill = (colour: Rgb): Rgb[] => Array.from({ length: opts.groups }, () => colour);

  switch (effect) {
    case "pulse": {
      // Breathing: brightness follows a raised cosine; colour steps through
      // the palette once per breath.
      const colour = palette[Math.floor(tick / CYCLE) % palette.length] ?? opts.a;
      const k = 0.5 - 0.5 * Math.cos((2 * Math.PI * (tick % CYCLE)) / CYCLE);

      return fill(blend(colour, BLACK, 1 - k));
    }
    case "strobe": {
      // One flip per tick; the on stroke steps through the palette every two
      // ticks, so a single-colour palette is a plain colour strobe and a
      // multi-colour one reads as a rainbow strobe.
      if (tick % 2 === 1) return fill(BLACK);

      return fill(palette[Math.floor(tick / 2) % palette.length] ?? opts.a);
    }
    case "jump": {
      // Hard palette step every tick (rainbow jump / RGB jump).
      return fill(palette[tick % palette.length] ?? opts.a);
    }
    case "wash": {
      // Smooth A -> B -> A interpolation over one cycle.
      const k = 0.5 - 0.5 * Math.cos((2 * Math.PI * (tick % CYCLE)) / CYCLE);

      return fill(blend(opts.a, opts.b, k));
    }
    case "spot": {
      // One group lit at a time, stepping through the rig (single spot).
      const lit = tick % Math.max(1, opts.groups);

      return Array.from({ length: opts.groups }, (_, i) => (i === lit ? opts.a : BLACK));
    }
  }
}
