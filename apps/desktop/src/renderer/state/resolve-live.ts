import { trackModelSchema, showPlanSchema } from "@autolight/contracts";
import { liveViewModel } from "../live.js";
import { makeDeck, makeFixture } from "@autolight/simulator";
import type { LiveState } from "./store.js";

// Resolve the decks actually loaded in Rekordbox right now.
// Reads the committed live-*.trackmodel/showplan fixtures the main process
// wrote from the real ANLZ cache — never mock tracks, never fake BPM.
// Later: main-process watcher streams this over `show/live` IPC (§132);
// until then the renderer resolves the committed fixtures directly.
export async function resolveLiveDecks(): Promise<{ live: LiveState; bpm: number | null } | null> {
  try {
    // Vite serves test-fixtures/ as publicDir (prod) with fs.allow (dev).
    const read = async (name: string): Promise<unknown> => {
      const res = await fetch(`./analysis/${name}`);
      if (!res.ok) return null;
      return (await res.json()) as unknown;
    };
    const t1 = await read("live-homecoming.trackmodel.json");
    const p1 = await read("live-homecoming.showplan.json");
    if (!t1 || !p1) return null;
    const track = trackModelSchema.parse(t1);
    const plan = showPlanSchema.parse(p1);
    const bpm = track.beatGrid.beats[0]?.bpm ?? null;
    const fx = [
      { ...makeFixture("left", 14, 0, 0), groups: ["PRIMARY"] },
      { ...makeFixture("right", 14, 1, 1), groups: ["SECONDARY"] },
    ];
    // Beat cursor: earliest section start = where the song's intro sits.
    // Real playhead arrives via DJ LINK (§7); until then show the intro look
    // at beat 1 so the venue preview renders the actual compiled plan.
    const beat = 1;
    const deckA = makeDeck({ deckId: 1, channelFader: 1, crossfader: 1, playing: true, track: { id: track.identity.id, sourceIds: {} } });
    const deckB = makeDeck({ deckId: 2, channelFader: 0, crossfader: 0, playing: false, track: null });
    const vm = liveViewModel({
      deckA, deckB,
      mixA: { state: deckA, beat, cues: plan.cues, impactStrength: 0.5 },
      mixB: { state: deckB, beat, cues: [], impactStrength: 0 },
      beatA: beat, beatB: beat, fixtures: fx, track,
      reactiveEnergy: 0, reactiveAmount: 0,
    });
    const section = track.sections.find((s) => beat >= s.startBeat && beat < s.endBeat);
    return {
      bpm,
      live: {
        source: "REKORDBOX",
        bpm,
        beat,
        deckA: { title: track.identity.title ?? track.identity.id, section: section?.kind, countdown: undefined },
        deckB: { title: "—", section: undefined, countdown: undefined },
        cues: vm.upcoming.map((c) => ({ ...c, durationBeats: 4, intensity: 0.8, priority: 10 })),
        cells: vm.cells,
      },
    };
  } catch {
    return null;
  }
}
