import type { DeckState, ShowCue, ShowPlan, TrackModel } from "@autolight/contracts";
import { audibleWeight } from "@autolight/dj-core";
import { coverageOf } from "@autolight/track-model";

// Live deck fields (spec 90): one pure derivation from snapshot data to the 17
// deck-card fields. No timing, no I/O. Missing data renders as null and the
// screen labels it, never a guessed number.

export interface DeckFieldSet {
  title: string;
  artist: string | null;
  source: "REKORDBOX" | "SERATO";
  playing: boolean;
  playheadSeconds: number;
  nativeBpm: number | null;
  effectiveBpm: number | null;
  pitchPercent: number | null;
  beat: number;
  bar: number;
  phrase: number;
  section: string | null;
  nextEvent: string | null;
  channelFader: number | null;
  weight: number;
  analysisQuality: string;
  artwork: null;
}

export function deckFields(
  state: DeckState,
  track: TrackModel | null,
  plan: ShowPlan | null,
  beat: number,
): DeckFieldSet {
  const grid = track?.beatGrid.beats ?? [];
  const whole = Math.max(0, Math.floor(beat));
  const section = track?.sections.find((s) => beat >= s.startBeat && beat < s.endBeat) ?? null;
  const upcoming = (plan?.cues ?? [])
    .filter((c) => c.startBeat > beat)
    .sort((a, b) => a.startBeat - b.startBeat);
  return {
    title: track?.identity.title ?? state.track?.id ?? "No track",
    artist: track?.identity.artist ?? null,
    source: state.source === "serato" ? "SERATO" : "REKORDBOX",
    playing: state.playing,
    playheadSeconds: state.playheadSeconds,
    nativeBpm: grid[0]?.bpm ?? null,
    effectiveBpm: state.effectiveBpm,
    pitchPercent: state.playRate === 1 ? 0 : (state.playRate - 1) * 100,
    beat: whole,
    bar: Math.floor(whole / 4) + 1,
    phrase: Math.floor(whole / 32) + 1,
    section: section?.kind ?? null,
    nextEvent: upcoming[0] ? `${upcoming[0].type} in ${Math.round(upcoming[0].startBeat - beat)} beats` : null,
    channelFader: state.channelFader,
    weight: audibleWeight(state),
    analysisQuality: track ? coverageOf(track).toUpperCase() : "NEEDS ANALYSIS",
    artwork: null,
  };
}

// Predictive field (spec 90, P-90): the large countdown. Drop programming
// wins over breakdowns over builds; silence past the horizon returns null.
export function predictiveLabel(cues: ShowCue[], beat: number, horizonBeats = 64): string | null {
  const after = cues.filter((c) => c.startBeat > beat).sort((a, b) => a.startBeat - b.startBeat);
  const at = (t: string): ShowCue | undefined => after.find((c) => c.type === t);
  const drop = at("white-hit") ?? at("impact") ?? after.find((c) => c.type === "drop");
  if (drop && drop.startBeat - beat <= horizonBeats) {
    return `DROP IN ${Math.max(1, Math.round(drop.startBeat - beat))}`;
  }
  const breakdown = at("breakdown-look") ?? at("breakdown");
  if (breakdown && breakdown.startBeat - beat <= horizonBeats) {
    return `BREAKDOWN IN ${Math.max(1, Math.round(breakdown.startBeat - beat))}`;
  }
  const build = after.find((c) => c.type === "build-ramp");
  if (build && beat >= build.startBeat && beat < build.startBeat + build.durationBeats) return "BUILD";
  return null;
}

// Next phrase boundary at or after beat (32-beat phrases). Style handover and
// blinder scheduling land here.
export function nextPhraseBeat(beat: number, phraseBeats = 32): number {
  return Math.ceil(beat / phraseBeats) * phraseBeats;
}
