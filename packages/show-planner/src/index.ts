import type { ShowPlan, ShowStyle, TrackModel } from "@autolight/contracts";

// Deterministic FNV-1a seed from track fingerprint (§27).
export function seedFor(trackId: string, plannerVersion: string, styleId: string): string {
  let h = 0x811c9dc5;
  for (const c of trackId + "|" + plannerVersion + "|" + styleId) {
    h ^= c.codePointAt(0) ?? 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function mulberry32(seedHex: string): () => number {
  let a = parseInt(seedHex.slice(0, 8), 16) >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const PLANNER_VERSION = "0.1.0";

// Venue-independent cues only (§75): spatial target names, never device addresses.
export function planShow(track: TrackModel, style: ShowStyle): ShowPlan {
  const seed = seedFor(track.identity.id, PLANNER_VERSION, style.id);
  const rand = mulberry32(seed);
  const cues: ShowPlan["cues"] = [];
  let lastWhite = -Infinity;
  for (const ev of track.musicalEvents) {
    if (ev.type === "drop") {
      // Restraint: no white-hit repeat without musical justification (§34).
      // ponytail: fixed 8-beat budget, measure real catalog before tuning
      const useWhite = ev.beat - lastWhite >= 8 && rand() < style.whiteHitFrequency;
      if (useWhite) {
        lastWhite = ev.beat;
        cues.push({ type: "white-hit", startBeat: ev.beat, durationBeats: 0.25, intensity: 1, target: "ALL", priority: 100 });
      } else {
        cues.push({ type: "impact", startBeat: ev.beat, durationBeats: 1, intensity: 0.9, target: "PRIMARY", priority: 90 });
      }
    } else if (ev.type === "predrop" || ev.type === "build-start") {
      cues.push({ type: "build-ramp", startBeat: ev.beat, durationBeats: ev.endBeat ? ev.endBeat - ev.beat : 8, intensity: 0.6, target: "ALL", priority: 50 });
    } else if (ev.type === "breakdown") {
      cues.push({ type: "breakdown-look", startBeat: ev.beat, durationBeats: ev.endBeat ? ev.endBeat - ev.beat : 16, intensity: 0.25, target: "AMBIENT", priority: 40 });
    }
  }
  return { schemaVersion: 1, plannerVersion: PLANNER_VERSION, trackId: track.identity.id, styleId: style.id, seed, cues };
}
