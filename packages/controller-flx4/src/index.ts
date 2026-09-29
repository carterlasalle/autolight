// FLX4 telemetry is secondary truth: never overrides DJ playhead (§11).
// CC/note numbers per official map; expressive hints only (filter sweep,
// pad roll, fader rise, loop shrink) inform the director, never STROBE().

export const CC = { CHANNEL_FADER_1: 0x13, CHANNEL_FADER_2: 0x14, CROSSFADER: 0x1f, FILTER_1: 0x17, FILTER_2: 0x18, TEMPO_1: 0x10, TEMPO_2: 0x11 } as const;
export const NOTE = { PLAY_1: 0x0b, PLAY_2: 0x0c, CUE_1: 0x0a, CUE_2: 0x0d, SYNC_1: 0x0e, SYNC_2: 0x0f } as const;

export type Flx4Hint =
  | { kind: "fader-rise"; channel: 1 | 2; value: number }
  | { kind: "filter-sweep"; channel: 1 | 2; value: number }
  | { kind: "transport"; control: keyof typeof NOTE; on: boolean };

export function sevenBit(v: number): number {
  return Math.min(1, Math.max(0, v / 127));
}

export function classifyCC(cc: number, value: number): Flx4Hint | null {
  const normalized = sevenBit(value);
  if (cc === CC.CHANNEL_FADER_1) return { kind: "fader-rise", channel: 1, value: normalized };
  if (cc === CC.CHANNEL_FADER_2) return { kind: "fader-rise", channel: 2, value: normalized };
  if (cc === CC.FILTER_1) return { kind: "filter-sweep", channel: 1, value: normalized };
  if (cc === CC.FILTER_2) return { kind: "filter-sweep", channel: 2, value: normalized };
  return null;
}
