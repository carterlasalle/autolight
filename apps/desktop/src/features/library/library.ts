import type { TrackModel } from "@autolight/contracts";

// Library row (§95): track + readiness status. No page-specific copies (§142).
export type Readiness = "READY" | "ANALYZING" | "NEEDS ANALYSIS" | "GRID WARNING" | "SOURCE MISSING";
export interface LibraryRow { trackId: string; title: string; artist: string; bpm: number | null; duration: number; status: Readiness }

export function rowForTrack(model: TrackModel | null, gridWarned: boolean, sourceMissing: boolean): LibraryRow {
  if (!model) return { trackId: "", title: "", artist: "", bpm: null, duration: 0, status: "NEEDS ANALYSIS" };
  if (sourceMissing) {
    return { trackId: model.identity.id, title: model.identity.title ?? "", artist: model.identity.artist ?? "", bpm: null, duration: model.durationSeconds, status: "SOURCE MISSING" };
  }
  if (gridWarned) {
    return { trackId: model.identity.id, title: model.identity.title ?? "", artist: model.identity.artist ?? "", bpm: null, duration: model.durationSeconds, status: "GRID WARNING" };
  }
  const ready = model.analysisCoverage === "full" || model.analysisCoverage === "structured";
  const bpm = model.beatGrid.beats[0]?.bpm ?? null;
  return { trackId: model.identity.id, title: model.identity.title ?? "", artist: model.identity.artist ?? "", bpm, duration: model.durationSeconds, status: ready ? "READY" : "NEEDS ANALYSIS" };
}

// Track Inspector lanes (§96): synchronized beat lanes for waveform/grid/sections/PSSI/stems/events/cues.
export interface InspectorLane { name: string; beats: (string | number | null)[] }
export function inspectorLanes(model: TrackModel): InspectorLane[] {
  return [
    { name: "sections", beats: model.sections.map((s) => s.kind) },
    { name: "events", beats: model.musicalEvents.map((e) => `${e.type}@${e.beat}`) },
    { name: "grid", beats: model.beatGrid.beats.map((b) => b.beatInBar) },
  ];
}
