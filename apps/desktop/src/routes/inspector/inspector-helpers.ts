import type { TrackModel } from "@autolight/contracts";

// Inspector view-model (T-UI-06): audition math plus lane selection stay pure
// here so the screen is a thin binder. Audition beat maps to a plan cue by
// beat distance; blend-space A/B is a two-style mix descriptor, not pixels.

export interface AuditionPick {
  beat: number;
  cueType: string;
  sendToLights: boolean;
}

export function auditionAtBeat(
  track: TrackModel | null,
  cues: { type: string; startBeat: number }[],
  beat: number,
  sendToLights: boolean,
): AuditionPick | null {
  if (!track) return null;
  const lastBeat = Math.max(1, ...track.sections.map((s) => s.endBeat));
  const clamped = Math.min(lastBeat, Math.max(0, Math.round(beat)));
  let best: { type: string; startBeat: number } | null = null;
  for (const c of cues) {
    if (c.startBeat <= clamped && (!best || c.startBeat > best.startBeat)) best = c;
  }
  return { beat: clamped, cueType: best?.type ?? "section-look", sendToLights };
}

export interface BlendView {
  styleA: string;
  styleB: string;
  mix: number;
}

export function blendView(styleA: string, styleB: string, mix: number): BlendView {
  return { styleA, styleB, mix: Math.min(1, Math.max(0, mix)) };
}

// Inspector defaults: the beats the audition and correction controls start on,
// taken from the installed track instead of hard-coded fixture beats. The
// screen seeds its editable beat from these values.
export interface InspectorDefaults {
  beat: number;
  dropBeat: number;
  nextBeat: number;
  sectionStart: number;
  sectionEnd: number;
}

export function inspectorDefaults(track: TrackModel | null): InspectorDefaults {
  if (track === null) return { beat: 0, dropBeat: 0, nextBeat: 0, sectionStart: 0, sectionEnd: 0 };
  const eventBeats = track.musicalEvents.map((e) => e.beat).sort((a, b) => a - b);
  const sectionStarts = track.sections.map((s) => s.startBeat).sort((a, b) => a - b);
  const beat = eventBeats[0] ?? sectionStarts[0] ?? 0;
  const dropBeat = track.musicalEvents.find((e) => e.type === "drop")?.beat ?? beat;
  const nextBeat = eventBeats.find((b) => b > dropBeat) ?? sectionStarts.find((b) => b > dropBeat) ?? dropBeat;
  const lastSection = track.sections[track.sections.length - 1];
  return {
    beat,
    dropBeat,
    nextBeat,
    sectionStart: lastSection?.startBeat ?? 0,
    sectionEnd: lastSection?.endBeat ?? Math.max(1, beat),
  };
}

// Corrections ops (T-UI-07, spec 97): pure op descriptors. The screen sends
// them over typed IPC; persistence and planner bumps live in T-PLAN-11.
export type CorrectionOp =
  | { op: "rename-section"; startBeat: number; label: string }
  | { op: "move-event"; fromBeat: number; toBeat: number }
  | { op: "delete-drop"; beat: number }
  | { op: "add-drop"; beat: number }
  | { op: "mark-fake-drop"; beat: number; actualBeat: number }
  | { op: "change-style"; style: string }
  | { op: "regenerate-section"; startBeat: number; endBeat: number }
  | { op: "lock-section"; startBeat: number; endBeat: number };

export function undoStack<T>(stack: T[][], next: T[]): T[][] {
  return [...stack, next];
}

export function redoPop<T>(stack: T[][]): { head: T[] | null; rest: T[][] } {
  if (stack.length === 0) return { head: null, rest: [] };
  return { head: stack[stack.length - 1] ?? null, rest: stack.slice(0, -1) };
}
