// Adaptive director (T-RUN-09, spec 71, DS-28).
//
// When no TrackModel exists the show still looks programmed, not reactive
// noise: the director holds one coherent phrase-length look at a time and
// changes it only on phrase boundaries. Phrase length comes from
// `runtime.adaptive.phraseBeats` (default 32 beats). A look is chosen from a
// deterministic phrase-length look library built from the same primitives the
// planner uses (section looks, spatial motion, accents, one exclusive impact
// at most, and a darkness preference), parameterized by energy level and
// style. Cooldowns from `runtime.adaptive.cooldownPhrases` keep the sequence
// varied, and the runtime restraint engine (no back-to-back identical looks,
// no strobe chasing, darkness stays bounded) always wins over novelty.
//
// DS-28 engines: `rules` picks from the phrase look library on phrase
// boundaries; `audio-informed` lets live energy/onsets (T-AUD-02) pick the
// energy level and accents; `combined` (default) uses rules for structure and
// audio only as an advisory nudge inside the same cooldown and variation
// bounds. FLX4 expressive hints (T-FLX-05) are consumed structurally as the
// same kind of advisory nudge: they never force a look, strobe, or palette.
//
// The state mirrors spec 71 exactly: current energy state, estimated phrase
// counter, recent motif history, palette, recent effects, cooldowns, darkness
// state, spatial direction.

export type DirectorEngine = "rules" | "audio-informed" | "combined";

/** runtime.adaptive.phraseBeats default. */
export const DEFAULT_PHRASE_BEATS = 32;
/** runtime.adaptive.cooldownPhrases default. */
export const DEFAULT_COOLDOWN_PHRASES = 2;
/** runtime.adaptive.minLooks default: the library never shrinks below this. */
export const DEFAULT_MIN_LOOKS = 24;

export type EnergyLevel = "low" | "mid" | "high";
export type SpatialDirection = "left" | "right" | "center" | "alternate";

/** Structural hint; FLX4 expressive hints match this shape without an import. */
export type DirectorHint =
  | { kind: "fader-rise"; channel: 1 | 2; value: number }
  | { kind: "filter-sweep"; channel: 1 | 2; value: number }
  | { kind: "transport"; control: string; on: boolean };

export interface PhraseLook {
  /** Stable look id, unique inside the library. */
  id: string;
  energy: EnergyLevel;
  /** Palette reference index into the style palette (never a raw color). */
  palette: number;
  /** Motif this look carries; recurrence reuses the same motif id. */
  motif: string;
  /** Spatial direction of the look's motion layer. */
  spatial: SpatialDirection;
  /** Whether this look's accent layer carries a strobe. */
  strobe: boolean;
  /** Fraction of the room held dark by this look, 0 to 1. */
  darkness: number;
}

/** Full spec 71 director state. */
export interface DirectorState {
  energy: EnergyLevel;
  phrase: number;
  motifs: string[];
  palette: number;
  effects: string[];
  cooldowns: Record<string, number>;
  darkness: number;
  spatial: SpatialDirection;
}

export interface DirectorOptions {
  engine?: DirectorEngine;
  phraseBeats?: number;
  cooldownPhrases?: number;
  minLooks?: number;
  library?: PhraseLook[];
}

export interface DirectorInput {
  /** Beat position on the adaptive clock (fractional beats allowed). */
  beat: number;
  /** Live energy 0 to 1 from T-AUD-02 (audio-informed and combined only). */
  energy?: number;
  /** Live onset flag from T-AUD-02 (accents only, never a look change). */
  onset?: boolean;
  /** FLX4 expressive hints (advisory only). */
  hints?: DirectorHint[];
}

export interface DirectorResult {
  look: PhraseLook;
  /** True only on the tick where a new phrase look was picked. */
  changed: boolean;
  state: DirectorState;
}

export function initialDirectorState(): DirectorState {
  return {
    energy: "mid",
    phrase: 0,
    motifs: [],
    palette: 0,
    effects: [],
    cooldowns: {},
    darkness: 0.2,
    spatial: "alternate",
  };
}

// Deterministic phrase counter: phrase 0 covers beats [0, phraseBeats).
export function phraseOf(beat: number, phraseBeats: number = DEFAULT_PHRASE_BEATS): number {
  if (!Number.isFinite(beat) || beat < 0) return 0;
  return Math.floor(beat / Math.max(1, phraseBeats));
}

function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// Phrase-length look library from the planner's primitive set: section looks
// (base), spatial motion (chase direction), accents (build energy), at most
// one exclusive impact per look, and a bounded darkness fraction. Energy and
// style parameterize the mix, never per-beat audio.
export function buildLookLibrary(opts: { minLooks?: number; seed?: string } = {}): PhraseLook[] {
  const minLooks = Math.max(1, opts.minLooks ?? DEFAULT_MIN_LOOKS);
  const energies: EnergyLevel[] = ["low", "mid", "high"];
  const spatials: SpatialDirection[] = ["left", "right", "center", "alternate"];
  const looks: PhraseLook[] = [];
  let i = 0;
  while (looks.length < minLooks) {
    const energy = energies[i % energies.length]!;
    const spatial = spatials[Math.floor(i / energies.length) % spatials.length]!;
    const palette = i % 4;
    // Restraint: strobe only on high-energy looks, every fourth one at most.
    const strobe = energy === "high" && i % 4 === 3;
    // Darkness stays bounded: low-energy looks rest darker, never black.
    const darkness = energy === "low" ? 0.35 : energy === "mid" ? 0.2 : 0.1;
    looks.push({
      id: `look-${looks.length}`,
      energy,
      palette,
      motif: `motif-${(looks.length % 6) + 1}`,
      spatial,
      strobe,
      darkness,
    });
    i++;
  }
  const seed = hashSeed(opts.seed ?? "adaptive");
  // Deterministic rotation so libraries with the same size differ by seed
  // without any randomness at pick time.
  const rotate = seed % Math.max(1, looks.length);
  return [...looks.slice(rotate), ...looks.slice(0, rotate)];
}

// Advisory nudge from audio energy and FLX4 hints: moves the desired energy
// at most one step, and only the combined/audio-informed engines listen.
// Rules mode ignores every advisory input.
function advisedEnergy(base: EnergyLevel, input: DirectorInput, engine: DirectorEngine): EnergyLevel {
  if (engine === "rules") return base;
  const order: EnergyLevel[] = ["low", "mid", "high"];
  let idx = order.indexOf(base);
  const live = input.energy;
  if (typeof live === "number" && Number.isFinite(live)) {
    const clamped = Math.min(1, Math.max(0, live));
    const target = order.indexOf(clamped >= 0.66 ? "high" : clamped >= 0.33 ? "mid" : "low");
    if (target > idx) idx = Math.min(order.length - 1, idx + 1);
    else if (target < idx) idx = Math.max(0, idx - 1);
  }
  for (const hint of input.hints ?? []) {
    if (hint.kind === "fader-rise" && hint.value > 0.7 && idx < order.length - 1) {
      idx += 1;
      break;
    }
  }
  return order[idx]!;
}

// Pick the next phrase look: same energy when the advisory agrees, otherwise
// the advised energy; among candidates prefer an unused motif and palette,
// skip cooled-down looks and the current look, and never pick a strobe look
// twice in a row. Deterministic: phrase counter breaks ties, no randomness.
export function pickPhraseLook(library: PhraseLook[], state: DirectorState, energy: EnergyLevel): PhraseLook {
  const atEnergy = library.filter((l) => l.energy === energy);
  const pool = atEnergy.length > 0 ? atEnergy : library;
  const last = state.effects[state.effects.length - 1];
  const lastStrobe = pool.find((l) => l.id === last)?.strobe === true;
  const candidates = pool.filter((l) => {
    if ((state.cooldowns[l.id] ?? 0) > 0) return false;
    if (l.id === last) return false;
    if (l.strobe && lastStrobe) return false;
    return true;
  });
  const usable = candidates.length > 0 ? candidates : pool.filter((l) => l.id !== last);
  const fallback = usable.length > 0 ? usable : pool;
  const ranked = [...fallback].sort((a, b) => {
    const aMotif = state.motifs.includes(a.motif) ? 1 : 0;
    const bMotif = state.motifs.includes(b.motif) ? 1 : 0;
    if (aMotif !== bMotif) return aMotif - bMotif;
    const aPal = a.palette === state.palette ? 1 : 0;
    const bPal = b.palette === state.palette ? 1 : 0;
    if (aPal !== bPal) return aPal - bPal;
    return a.id < b.id ? -1 : 1;
  });
  // Note: deterministic tie-break by phrase counter rotates through equal
  // candidates instead of always taking the first; per-look history if this
  // ever looks samey.
  return ranked[(state.phrase * 7) % Math.max(1, ranked.length)] ?? ranked[0]!;
}

// One director tick. Looks change only when the phrase counter advances;
// inside a phrase the same look is returned with changed=false. Onsets and
// hints never force a change mid-phrase; they only bias the next pick.
export function directorTick(
  state: DirectorState,
  input: DirectorInput,
  opts: DirectorOptions = {},
): DirectorResult {
  const engine = opts.engine ?? "combined";
  const phraseBeats = opts.phraseBeats ?? DEFAULT_PHRASE_BEATS;
  const cooldownPhrases = opts.cooldownPhrases ?? DEFAULT_COOLDOWN_PHRASES;
  const library = opts.library ?? buildLookLibrary(opts.minLooks === undefined ? {} : { minLooks: opts.minLooks });
  const phrase = phraseOf(input.beat, phraseBeats);
  const current = state.effects[state.effects.length - 1];
  const currentLook = library.find((l) => l.id === current);
  if (phrase <= state.phrase && currentLook !== undefined) {
    return { look: currentLook, changed: false, state };
  }
  const energy = advisedEnergy(state.energy, input, engine);
  const look = pickPhraseLook(library, state, energy);
  const decayed: Record<string, number> = {};
  for (const [k, v] of Object.entries(state.cooldowns)) decayed[k] = Math.max(0, v - 1);
  const next: DirectorState = {
    energy: look.energy,
    phrase,
    motifs: [...state.motifs.slice(-3), look.motif],
    palette: look.palette,
    effects: [...state.effects.slice(-3), look.id],
    cooldowns: { ...decayed, [look.id]: Math.max(1, cooldownPhrases) },
    darkness: look.darkness,
    spatial: look.spatial,
  };
  return { look, changed: true, state: next };
}
