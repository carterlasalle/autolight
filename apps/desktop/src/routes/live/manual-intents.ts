import type { TrackModel } from "@autolight/contracts";

// Manual lane intents (T-UI-04): every control names its typed IPC channel
// and payload. The screen binds these; nothing here touches the store or IPC.
// The palette track pick is a plain colour set: venue/set-color carries no
// custom flag (the IPC schema strips it), so the ControlGrid's Custom switch
// chooses which swatches to offer, not the payload. Flash/flop coverage lives
// in live-view, which always pairs a resume with its own preceding freeze.
type ManualChannel =
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

export function blinderIntent(): ManualIntent {
  return { channel: "show/trigger-build", payload: { version: 1 } };
}

export function palettePickIntent(rgb: [number, number, number]): ManualIntent {
  const clamped: [number, number, number] = [
    Math.min(255, Math.max(0, Math.round(rgb[0]))),
    Math.min(255, Math.max(0, Math.round(rgb[1]))),
    Math.min(255, Math.max(0, Math.round(rgb[2]))),
  ];

  return { channel: "venue/set-color", payload: { version: 1, rgb: clamped } };
}

export function freezeHoldIntent(held: boolean): ManualIntent {
  return held
    ? { channel: "master/resume", payload: { version: 1, at: "bar" } }
    : { channel: "master/freeze", payload: { version: 1, frozen: true } };
}

export function sensitivityIntent(value: number): ManualIntent {
  const clamped = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

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

  return kinds.map((k) => {
    const swatch = SWATCH_BY_KIND[k];

    // Surface contracts drift loudly instead of silently resolving to white:
    // a warn costs nothing in prod and makes a missing mapping detectable.
    if (swatch === undefined) console.warn(`trackPalette: no swatch for section kind "${k}"; update SWATCH_BY_KIND with the new contracts kind`);

    return swatch ?? [255, 255, 255];
  });
}
