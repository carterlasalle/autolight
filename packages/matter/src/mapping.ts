// T-MAT-02: Matter control mapping (F-MAT-01).
//
// Whole fixture only: Matter has no segment stream, so one RGB frame becomes
// one OnOff write plus one LevelControl write plus one ColorControl write,
// or a single Off write for black. LevelControl always carries transition
// time 0 (tenths of a second) for show use; colour temperature is a separate
// setup-only path and never appears in show-time frames.

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface MatterWrite {
  cluster: string;
  command: string;
  payload: Record<string, number>;
}

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

/** RGB to hue/saturation/level in Matter 0..254 units. */
export function rgbToHsl254(rgb: Rgb): { hue: number; saturation: number; level: number } {
  const r = clampByte(rgb.r) / 255;
  const g = clampByte(rgb.g) / 255;
  const b = clampByte(rgb.b) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const range = max - min;
  let hueDeg = 0;
  if (range > 0) {
    if (max === r) hueDeg = 60 * (((g - b) / range) % 6);
    else if (max === g) hueDeg = 60 * ((b - r) / range + 2);
    else hueDeg = 60 * ((r - g) / range + 4);
    if (hueDeg < 0) hueDeg += 360;
  }
  const lightness = (max + min) / 2;
  const saturation = range === 0 ? 0 : range / (1 - Math.abs(2 * lightness - 1));
  return {
    hue: Math.round((hueDeg / 360) * 254),
    saturation: Math.round(saturation * 254),
    level: Math.max(1, Math.round((max * 254))),
  };
}

/** One show-time frame to Matter writes. Black maps to Off (the level is
 *  preserved in the node, so the next On restores it). Every other frame is
 *  On plus level plus hue/saturation, each with transitionDs 0. */
export function toMatterWrites(rgb: Rgb): MatterWrite[] {
  if (clampByte(rgb.r) === 0 && clampByte(rgb.g) === 0 && clampByte(rgb.b) === 0) {
    return [{ cluster: "onOff", command: "off", payload: {} }];
  }
  const { hue, saturation, level } = rgbToHsl254(rgb);
  return [
    { cluster: "onOff", command: "on", payload: {} },
    { cluster: "levelControl", command: "moveToLevel", payload: { level, transitionDs: 0 } },
    { cluster: "colorControl", command: "moveToHueAndSaturation", payload: { hue, saturation, transitionDs: 0 } },
  ];
}

/** Setup-only colour temperature path (never in show-time frames). Kelvin to
 *  mireds, clamped to the Matter ColorControl range. */
export function cctToMatterSetupWrites(kelvin: number, level01: number): MatterWrite[] {
  const mireds = Math.max(147, Math.min(652, Math.round(1_000_000 / kelvin)));
  const level = Math.max(1, Math.min(254, Math.round(level01 * 254)));
  return [
    { cluster: "onOff", command: "on", payload: {} },
    { cluster: "levelControl", command: "moveToLevel", payload: { level, transitionDs: 0 } },
    { cluster: "colorControl", command: "moveToColorTemperature", payload: { colorTemperatureMireds: mireds, transitionDs: 0 } },
  ];
}

/** Minimum spacing between commands at a command rate. The configured rate
 *  is `govee.matter.commandRateHz` (default 10); this helper is the math the
 *  pacer uses, kept here so it is tested without timers. */
export function minIntervalMs(rateHz: number): number {
  return 1000 / rateHz;
}
