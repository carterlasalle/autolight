import type { ShowCue, ShowPlan, ShowStyle, TrackModel } from "@autolight/contracts";

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

// Built-in show styles (§135): constraints, not fixed animations.
export const BUILT_IN_STYLES: Record<string, ShowStyle> = {
  club: { id: "club", intensityRange: [0.2, 1], darknessPreference: 0.3, reactiveAmount: 0.15, whiteHitFrequency: 0.7, strobeFrequency: 0.2 },
  house: { id: "house", intensityRange: [0.3, 0.9], darknessPreference: 0.2, reactiveAmount: 0.2, whiteHitFrequency: 0.5, strobeFrequency: 0.1 },
  festival: { id: "festival", intensityRange: [0.4, 1], darknessPreference: 0.15, reactiveAmount: 0.25, whiteHitFrequency: 0.9, strobeFrequency: 0.4 },
  lounge: { id: "lounge", intensityRange: [0.1, 0.5], darknessPreference: 0.5, reactiveAmount: 0.1, whiteHitFrequency: 0.1, strobeFrequency: 0 },
  pop: { id: "pop", intensityRange: [0.3, 0.9], darknessPreference: 0.2, reactiveAmount: 0.2, whiteHitFrequency: 0.6, strobeFrequency: 0.15 },
  dark: { id: "dark", intensityRange: [0.05, 0.6], darknessPreference: 0.7, reactiveAmount: 0.1, whiteHitFrequency: 0.3, strobeFrequency: 0.05 },
  minimal: { id: "minimal", intensityRange: [0.15, 0.6], darknessPreference: 0.4, reactiveAmount: 0.05, whiteHitFrequency: 0.2, strobeFrequency: 0 },
};

// sRGB ↔ linear + OKLCH-ish hue rotation for palette motion (§28: never naive sRGB).
function srgbToLinear(v: number): number {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
function linearToSrgb(v: number): number {
  const c = Math.min(1, Math.max(0, v));
  return Math.round((c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055) * 255);
}
function mixLinear(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0]! + (b[0]! - a[0]!) * t, a[1]! + (b[1]! - a[1]!) * t, a[2]! + (b[2]! - a[2]!) * t];
}
export function blendRgb(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  const la: [number, number, number] = [srgbToLinear(a[0]!), srgbToLinear(a[1]!), srgbToLinear(a[2]!)];
  const lb: [number, number, number] = [srgbToLinear(b[0]!), srgbToLinear(b[1]!), srgbToLinear(b[2]!)];
  const m = mixLinear(la, lb, Math.min(1, Math.max(0, t)));
  return [linearToSrgb(m[0]!), linearToSrgb(m[1]!), linearToSrgb(m[2]!)];
}

// Whole-song identity (§28): 2-3 core hues + white impact (§29), seeded per track.
export interface TrackIdentity2 { coreHues: [number, number]; accentHue: number }
export function trackIdentity(seedHex: string, rand: () => number): TrackIdentity2 {
  void seedHex;
  const h1 = Math.floor(rand() * 360);
  const h2 = (h1 + 120 + Math.floor(rand() * 120)) % 360; // triadic-ish spread
  return { coreHues: [h1, h2], accentHue: (h1 + 180) % 360 };
}

// Section contrast map (§35): energy ceiling per section kind.
const SECTION_ENERGY: Record<string, number> = {
  intro: 0.3, verse: 0.45, prechorus: 0.6, build: 0.8, drop: 1, chorus: 0.9,
  breakdown: 0.25, bridge: 0.5, instrumental: 0.6, solo: 0.7, outro: 0.3,
  transition: 0.5, unknown: 0.5,
};
export function sectionEnergy(kind: string): number {
  return SECTION_ENERGY[kind] ?? 0.5;
}

// Motif recurrence (§37): same normalized kind reuses direction variant.
export function motifVariant(kind: string, occurrence: number): "forward" | "reverse" {
  void kind;
  return occurrence % 2 === 0 ? "forward" : "reverse";
}

// Venue-independent cues only (§75): spatial target names, never device addresses.
export function planShow(track: TrackModel, style: ShowStyle): ShowPlan {
  const seed = seedFor(track.identity.id, PLANNER_VERSION, style.id);
  const rand = mulberry32(seed);
  const identity = trackIdentity(seed, rand);
  void identity;
  const cues: ShowCue[] = [];
  const kindCount: Record<string, number> = {};

  // Phrase-level programming: each section gets a look scaled by contrast (§30, §35).
  for (const section of track.sections) {
    const n = kindCount[section.kind] ?? 0;
    kindCount[section.kind] = n + 1;
    const energy = Math.min(Math.max(sectionEnergy(section.kind), style.intensityRange[0]), style.intensityRange[1]);
    const variant = motifVariant(section.kind, n);
    cues.push({
      type: section.kind === "breakdown" ? "breakdown-look" : "section-look",
      startBeat: section.startBeat,
      durationBeats: Math.max(0, section.endBeat - section.startBeat),
      intensity: energy,
      target: variant === "forward" ? "PRIMARY" : "SECONDARY",
      priority: 10,
    });
    // Bar-level alternation inside long sections (§30): 8-beat chase flips.
    const len = section.endBeat - section.startBeat;
    for (let b = section.startBeat + 8; b < section.endBeat; b += 8) {
      cues.push({
        type: "chase-flip", startBeat: b, durationBeats: Math.min(8, section.endBeat - b),
        intensity: energy, target: (b / 8) % 2 === 0 ? "LEFT" : "RIGHT", priority: 11,
      });
    }
    void len;
  }

  let lastWhite = -Infinity;
  const clamp = (v: number): number => Math.min(style.intensityRange[1], Math.max(style.intensityRange[0], v));
  for (const ev of track.musicalEvents) {
    if (ev.type === "drop") {
      // Restraint: no white-hit repeat without musical justification (§34).
      // Fixed 8-beat budget; now planner.restraint.whiteHitMinBeats (default 16), tune from catalog.
      const useWhite = ev.beat - lastWhite >= 8 && rand() < style.whiteHitFrequency;
      if (useWhite) {
        lastWhite = ev.beat;
        cues.push({ type: "white-hit", startBeat: ev.beat, durationBeats: 0.25, intensity: clamp(1), target: "ALL", priority: 100 });
      } else {
        cues.push({ type: "impact", startBeat: ev.beat, durationBeats: 1, intensity: clamp(0.9), target: "PRIMARY", priority: 90 });
      }
    } else if (ev.type === "predrop" || ev.type === "build-start") {
      cues.push({ type: "build-ramp", startBeat: ev.beat, durationBeats: ev.endBeat ? ev.endBeat - ev.beat : 8, intensity: clamp(0.6), target: "ALL", priority: 50 });
    } else if (ev.type === "breakdown") {
      cues.push({ type: "breakdown-look", startBeat: ev.beat, durationBeats: ev.endBeat ? ev.endBeat - ev.beat : 16, intensity: 0.25, target: "AMBIENT", priority: 40 });
    } else if (ev.type === "fake-drop") {
      // Hold darkness through the fake, impact lands on the real one (§25).
      cues.push({ type: "blackout", startBeat: ev.beat, durationBeats: ev.endBeat ? ev.endBeat - ev.beat : 2, intensity: 0, target: "ALL", priority: 95 });
    }
  }
  cues.sort((a, b) => a.startBeat - b.startBeat || b.priority - a.priority);
  return { schemaVersion: 1, plannerVersion: PLANNER_VERSION, trackId: track.identity.id, styleId: style.id, seed, cues };
}

// Track corrections (§97): regenerate one section, keep locked edits.
// Locked cue indices survive; unlocked cues in [start, end) are replaced.
export function regenerateSection(plan: ShowPlan, startBeat: number, endBeat: number, fresh: ShowCue[], lockedIndices: number[]): ShowPlan {
  const locked = new Set(lockedIndices);
  const kept = plan.cues.filter((c, i) => locked.has(i) || c.startBeat + c.durationBeats <= startBeat || c.startBeat >= endBeat);
  return { ...plan, cues: [...kept, ...fresh].sort((a, b) => a.startBeat - b.startBeat || b.priority - a.priority) };
}

// Show quality invariants (§114): reject pathological generations.
export function validatePlan(plan: ShowPlan, durationBeats: number): string[] {
  const problems: string[] = [];
  const exclusives = plan.cues.filter((c) => c.type === "blackout" || c.type === "white-hit").sort((a, b) => a.startBeat - b.startBeat);
  for (let i = 1; i < exclusives.length; i++) {
    const prev = exclusives[i - 1]!;
    const cur = exclusives[i]!;
    if (cur.startBeat < prev.startBeat + prev.durationBeats) problems.push(`overlapping exclusive ${prev.type}@${prev.startBeat} vs ${cur.type}@${cur.startBeat}`);
  }
  for (const c of plan.cues) {
    if (c.durationBeats < 0) problems.push(`negative duration ${c.type}@${c.startBeat}`);
    if (c.startBeat < 0 || c.startBeat > durationBeats) problems.push(`out-of-range ${c.type}@${c.startBeat}`);
  }
  const paletteChanges = plan.cues.filter((c) => c.type === "section-look").length;
  if (paletteChanges > durationBeats) problems.push(`palette change every beat (${paletteChanges})`);
  return problems;
}

// Quantitative diagnostics (§115): describe the generation, never score it.
export function evaluatePlan(plan: ShowPlan): { cueCount: number; blackoutBeats: number; whiteHits: number; strobeBeats: number; meanIntensity: number } {
  const at = (t: string): ShowCue[] => plan.cues.filter((c) => c.type === t);
  const beats = (cs: ShowCue[]): number => cs.reduce((n, c) => n + c.durationBeats, 0);
  return {
    cueCount: plan.cues.length,
    blackoutBeats: beats(at("blackout")),
    whiteHits: at("white-hit").length,
    strobeBeats: beats(at("strobe")),
    meanIntensity: plan.cues.length ? plan.cues.reduce((n, c) => n + c.intensity, 0) / plan.cues.length : 0,
  };
}
