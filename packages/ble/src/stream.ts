// BLE segment stream (T-BLE-04 and T-BLE-03 pacing; WP04 segment stream facts).
//
// Converts a frame into masked writes: zones with identical colours group
// into one 33 05 15 01 write per distinct colour, ordered largest group
// first to minimise visible tearing. Achievable rate is
// budget / distinctColours, reported so the planner and mixer simplify
// patterns on BLE fixtures. Optional quantisation
// (govee.ble.colorQuantizeLevels) reduces distinct colours. Single colour
// frames take the fast path: one 0d write, or the host colour channel
// a5 02 83 when qualified (temporary hold, refresh before render_hold_ms).
// Blackout on BLE is a masked write of black to all zones, never power off
// during a show (spec 47).
import {
  bleColorMasked,
  bleColorSingle,
  bleHostColorOne,
  type BleRgb,
} from "./commands.js";

export interface BleStreamPlan {
  /** One masked write per distinct colour, largest group first. */
  writes: Array<{ color: BleRgb; zones: number[] }>;
  distinctColours: number;
  /** Effective frames per second at the unit's budget. */
  effectiveFps: number;
  /** True when the fast path applies (every zone one colour). */
  singleColour: boolean;
}

function keyOf(color: BleRgb, levels: number): string {
  if (levels <= 0) return `${color.r},${color.g},${color.b}`;
  const q = (v: number): number => Math.min(levels - 1, Math.floor(Math.min(255, Math.max(0, Math.round(v))) / 256 * levels));
  return `${q(color.r)},${q(color.g)},${q(color.b)}`;
}

/** Plans masked writes for a frame of zoneCount RGB triples. */
export function planBleFrame(
  frame: Uint8Array,
  zoneCount: number,
  budgetHz: number,
  quantizeLevels = 0,
): BleStreamPlan {
  if (frame.length !== zoneCount * 3) {
    throw new RangeError(`BLE frame needs ${zoneCount * 3} bytes for ${zoneCount} zones, got ${frame.length}`);
  }
  const groups = new Map<string, { color: BleRgb; zones: number[] }>();
  for (let z = 0; z < zoneCount; z++) {
    const color: BleRgb = { r: frame[z * 3] ?? 0, g: frame[z * 3 + 1] ?? 0, b: frame[z * 3 + 2] ?? 0 };
    const key = keyOf(color, quantizeLevels);
    const held = groups.get(key);
    if (held === undefined) groups.set(key, { color, zones: [z] });
    else held.zones.push(z);
  }
  const writes = [...groups.values()].sort((a, b) => b.zones.length - a.zones.length);
  const distinctColours = writes.length;
  return {
    writes,
    distinctColours,
    effectiveFps: distinctColours === 0 ? budgetHz : budgetHz / distinctColours,
    singleColour: distinctColours <= 1,
  };
}

/** Blackout frame: every zone black. Sent masked, never as power off. */
export function bleBlackoutFrame(zoneCount: number): Uint8Array {
  return new Uint8Array(Math.max(0, zoneCount) * 3);
}

export interface BleStreamEncodeOptions {
  zoneCount: number;
  budgetHz: number;
  quantizeLevels?: number;
  /** True when the unit qualified the host colour channel. */
  hostColorQualified?: boolean;
  /** Kelvins carried on masked writes; 0 for RGB. */
  kelvin?: number;
}

/** Encodes one frame into BLE writes: fast path or one masked write per colour. */
export function encodeBleStreamFrame(frame: Uint8Array, opts: BleStreamEncodeOptions): Uint8Array[] {
  const plan = planBleFrame(frame, opts.zoneCount, opts.budgetHz, opts.quantizeLevels ?? 0);
  if (plan.singleColour) {
    const first = plan.writes[0];
    const color: BleRgb = first === undefined ? { r: 0, g: 0, b: 0 } : first.color;
    if (opts.hostColorQualified === true) return [bleHostColorOne(color)];
    return [bleColorSingle(color, opts.kelvin ?? 0)];
  }
  return plan.writes.map((w) => bleColorMasked(w.color, w.zones, opts.zoneCount, opts.kelvin ?? 0));
}

// ---------------------------------------------------------------------------
// Renderer feed (T-BLE-05: renderer frames over the planning seam above)
// ---------------------------------------------------------------------------

/** Feedback the renderer and planner read after each streamed frame. */
export interface BleFrameFeedback {
  distinctColours: number;
  /** budgetHz divided by distinctColours for this frame. */
  effectiveFps: number;
  singleColour: boolean;
  quantized: boolean;
}

/** One streamed renderer frame: link-ready writes plus planner feedback. */
export interface BleStreamedFrame {
  writes: Uint8Array[];
  feedback: BleFrameFeedback;
}

/**
 * Streams one renderer frame (zoneCount RGB triples, as renderFrame produces
 * for one fixture) over the planning seam above. The writes go to the link;
 * the feedback tells the planner and mixer the fixture's current effective
 * capability so patterns simplify when effectiveFps drops below show rate.
 */
export function streamBleRendererFrame(frame: Uint8Array, opts: BleStreamEncodeOptions): BleStreamedFrame {
  const writes = encodeBleStreamFrame(frame, opts);
  const plan = planBleFrame(frame, opts.zoneCount, opts.budgetHz, opts.quantizeLevels ?? 0);
  return {
    writes,
    feedback: {
      distinctColours: plan.distinctColours,
      effectiveFps: plan.effectiveFps,
      singleColour: plan.singleColour,
      quantized: (opts.quantizeLevels ?? 0) > 0,
    },
  };
}
