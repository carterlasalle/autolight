import { describe, expect, it } from "vitest";
import {
  buildLookLibrary,
  directorTick,
  initialDirectorState,
  phraseOf,
  DEFAULT_COOLDOWN_PHRASES,
  DEFAULT_MIN_LOOKS,
  DEFAULT_PHRASE_BEATS,
  type DirectorState,
  type PhraseLook,
} from "./index.js";

// P-71-adaptive: 256 beats with no TrackModel. Looks change only on phrase
// boundaries, cooldowns respected, no two consecutive identical looks.

const PHRASE = DEFAULT_PHRASE_BEATS;

function run(beats: number, energy = 0.5, opts: { cooldown?: number } = {}): { changes: number[]; ids: string[]; states: DirectorState[] } {
  const library = buildLookLibrary({ minLooks: DEFAULT_MIN_LOOKS });
  let state = initialDirectorState();
  const changes: number[] = [];
  const ids: string[] = [];
  const states: DirectorState[] = [];
  for (let beat = 0; beat < beats; beat++) {
    const out = directorTick(state, { beat, energy }, opts.cooldown === undefined ? { library } : { library, cooldownPhrases: opts.cooldown });
    if (out.changed) changes.push(beat);
    ids.push(out.look.id);
    states.push(out.state);
    state = out.state;
  }
  return { changes, ids, states };
}

describe("adaptive director (P-71)", () => {
  it("holds one look per phrase over 256 beats with no TrackModel", () => {
    const { changes } = run(256);
    expect(changes).toEqual([0, 32, 64, 96, 128, 160, 192, 224]);
  });

  it("never repeats the same look twice in a row", () => {
    const { ids } = run(256, 0.9);
    const phrases = [0, 32, 64, 96, 128, 160, 192, 224].map((b) => ids[b]);
    for (let i = 1; i < phrases.length; i++) expect(phrases[i]).not.toBe(phrases[i - 1]);
  });
  it("respects cooldowns across the run", () => {
    const { changes, ids } = run(256);
    for (let i = 0; i < changes.length; i++) {
      for (let j = i + 1; j < changes.length; j++) {
        const gap = j - i;
        if (ids[changes[i]!] === ids[changes[j]!] && gap <= DEFAULT_COOLDOWN_PHRASES) {
          throw new Error(`look ${ids[changes[i]!]} reused after ${gap} phrases`);
        }
      }
    }
  });

  it("keeps the beat inside a phrase on the same look", () => {
    const library = buildLookLibrary({ minLooks: 8 });
    let state = initialDirectorState();
    const first = directorTick(state, { beat: 0 }, { library });
    state = first.state;
    for (const beat of [0.5, 7, 15, 31.75]) {
      const out = directorTick(state, { beat, energy: 1 }, { library });
      expect(out.changed).toBe(false);
      expect(out.look.id).toBe(first.look.id);
      expect(out.state).toBe(state);
    }
  });

  it("changes only at the phrase edge, never mid-phrase from audio or hints", () => {
    const library = buildLookLibrary({ minLooks: 8 });
    let state = initialDirectorState();
    state = directorTick(state, { beat: 0 }, { library }).state;
    const mid = directorTick(
      state,
      { beat: 16, energy: 1, onset: true, hints: [{ kind: "fader-rise", channel: 1, value: 1 }] },
      { library },
    );
    expect(mid.changed).toBe(false);
    const edge = directorTick(
      state,
      { beat: 32, energy: 1, onset: true, hints: [{ kind: "fader-rise", channel: 1, value: 1 }] },
      { library },
    );
    expect(edge.changed).toBe(true);
  });

  it("ignores audio and hints in rules mode but listens in combined", () => {
    const library = buildLookLibrary({ minLooks: 8 });
    const quiet = directorTick(initialDirectorState(), { beat: 0, energy: 0 }, { library, engine: "rules" });
    const loud = directorTick(initialDirectorState(), { beat: 0, energy: 1 }, { library, engine: "rules" });
    expect(quiet.look.id).toBe(loud.look.id);
    const combinedLoud = directorTick(
      { ...initialDirectorState(), energy: "low" },
      { beat: 0, energy: 1 },
      { library, engine: "combined" },
    );
    expect(combinedLoud.look.energy).not.toBe("low");
  });

  it("builds a library of at least minLooks coherent phrase looks", () => {
    const library = buildLookLibrary({ minLooks: 24 });
    expect(library.length).toBeGreaterThanOrEqual(24);
    expect(new Set(library.map((l) => l.id)).size).toBe(library.length);
    for (const look of library) {
      expect(look.darkness).toBeGreaterThanOrEqual(0);
      expect(look.darkness).toBeLessThanOrEqual(0.5);
      expect(look.palette).toBeGreaterThanOrEqual(0);
      expect(typeof look.motif).toBe("string");
    }
    expect(library.some((l) => l.strobe)).toBe(true);
    let strobeRuns = 0;
    const seq = run(256, 1).ids.filter((_, i) => i % PHRASE === 0);
    for (let i = 1; i < seq.length; i++) {
      const prev = library.find((l) => l.id === seq[i - 1])!;
      const cur = library.find((l) => l.id === seq[i])!;
      if (prev.strobe && cur.strobe) strobeRuns++;
    }
    expect(strobeRuns).toBe(0);
  });

  it("counts phrases deterministically from the beat", () => {
    expect(phraseOf(0)).toBe(0);
    expect(phraseOf(31.9)).toBe(0);
    expect(phraseOf(32)).toBe(1);
    expect(phraseOf(-4)).toBe(0);
  });

  it("tracks the full spec 71 state on every pick", () => {
    const out = directorTick(initialDirectorState(), { beat: 0 }, {});
    const s = out.state;
    expect(s.phrase).toBe(0);
    expect(s.motifs).toEqual([out.look.motif]);
    expect(s.effects).toEqual([out.look.id]);
    expect(s.palette).toBe(out.look.palette);
    expect(s.darkness).toBe(out.look.darkness);
    expect(s.spatial).toBe(out.look.spatial);
    expect(s.cooldowns[out.look.id]).toBeGreaterThanOrEqual(1);
  });

  it("accepts FLX4 expressive hints structurally without importing them", () => {
    const library = buildLookLibrary({ minLooks: 8 });
    const hinted = directorTick(
      { ...initialDirectorState(), energy: "low" },
      { beat: 0, energy: 0, hints: [{ kind: "fader-rise", channel: 2, value: 0.9 }] },
      { library },
    );
    expect(hinted.changed).toBe(true);
    const look: PhraseLook = hinted.look;
    expect(typeof look.id).toBe("string");
  });
});
