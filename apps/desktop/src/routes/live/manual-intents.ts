import type { TrackModel } from "@autolight/contracts";

// Manual lane intents (T-UI-04): every control names its typed IPC channel
// and payload. The screen binds these; nothing here touches the store or IPC.
// Restraint-aware blinder and palette-pick-from-track live in the ControlGrid:
// blinder intent carries the next-phrase beat, palette pick carries the track
// palette colour, custom free colour is an explicit opt-in flag.

export type ManualChannel =
  | "show/energy" | "show/trigger-build" | "show/trigger-drop"
  | "venue/set-color" | "master/intensity" | "master/resume" | "master/freeze";

export interface ManualIntent {
  channel: ManualChannel;
  payload: Record<string, unknown>;
}

export function energyIntent(tier: "LOW" | "MED" | "HIGH"): ManualIntent {
  return { channel: "show/energy", payload: { version: 1, tier } };
}

export function buildIntent(): ManualIntent {
  return { channel: "show/trigger-build", payload: { version: 1 } };
}

export function dropIntent(): ManualIntent {
  return { channel: "show/trigger-drop", payload: { version: 1 } };
}

export function blinderIntent(nextPhraseBeat: number): ManualIntent {
  return { channel: "show/trigger-build", payload: { version: 1, at: nextPhraseBeat } };
}

export function palettePickIntent(rgb: [number, number, number], custom: boolean): ManualIntent {
  return { channel: "venue/set-color", payload: { version: 1, rgb, custom } };
}

export function flashIntent(on: boolean): ManualIntent {
  return on
    ? { channel: "master/resume", payload: { version: 1, at: "bar" } }
    : { channel: "master/freeze", payload: { version: 1, frozen: true } };
}

export function sensitivityIntent(value: number): ManualIntent {
  const clamped = Math.min(2, Math.max(0.5, value));
  return { channel: "master/intensity", payload: { version: 1, value: clamped } };
}

// Track palette:
const SWATCH_BY_KIND: Record<string, [number, number, number]> = {
  drop: [255, 200, 0],
  chorus: [255, 200, 0],
  breakdown: [12, 36, 150],
  verse: [12, 36, 150],
};
export function trackPalette(track: TrackModel | null): [number, number, number][] {
  if (!track) return [];
  const kinds: string[] = [];
  for (const s of track.sections) {
    if (!kinds.includes(s.kind)) kinds.push(s.kind);
  }
  return kinds.map((k) => SWATCH_BY_KIND[k] ?? [255, 255, 255]);
}
