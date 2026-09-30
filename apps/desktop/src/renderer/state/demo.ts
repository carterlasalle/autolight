import { useEffect } from "react";
import { useShell, invoke } from "./store.js";
import { liveViewModel } from "../live.js";
import { makeDeck, makeFixture } from "@autolight/simulator";

// Demo show feed: drives the store's `live` + `bpm` from the real
// view-model until the main-process show loop streams over IPC (§132).
// Timers are preview-cursor only; 60Hz cadence stays main-process owned.
export function useDemoShow(): void {
  const set = useShell((s) => s.set);
  const running = useShell((s) => s.running);
  const sensitivity = useShell((s) => s.sensitivity);
  const tier = useShell((s) => s.tier);
  const target = useShell((s) => s.target);
  const bpm = useShell((s) => s.bpm);

  useEffect(() => {
    if (!running) return;
    const fx = [
      { ...makeFixture("left", 14, 0, 0), groups: ["PRIMARY"] },
      { ...makeFixture("right", 14, 1, 1), groups: ["SECONDARY"] },
    ];
    const cues = [
      { type: "section-look", startBeat: 0, durationBeats: 64, intensity: 0.8, target: "PRIMARY", priority: 10 },
      { type: "section-look", startBeat: 0, durationBeats: 64, intensity: 0.6, target: "SECONDARY", priority: 10 },
      { type: "build-ramp", startBeat: 48, durationBeats: 16, intensity: 0.9, target: "ALL", priority: 50 },
    ];
    let beat = 0;
    const timer = setInterval(() => {
      beat = (beat + 0.5) % 64;
      const deckA = makeDeck({ deckId: 1, channelFader: 1, crossfader: target === "B" ? 0 : 1, playing: true, track: { id: "demo-a", sourceIds: {} } });
      const deckB = makeDeck({ deckId: 2, channelFader: 1, crossfader: target === "A" ? 0 : 1, playing: true, track: { id: "demo-b", sourceIds: {} } });
      const vm = liveViewModel({
        deckA, deckB,
        mixA: { state: deckA, beat, cues, impactStrength: tier === "HIGH" ? 1 : 0.5 },
        mixB: { state: deckB, beat, cues, impactStrength: 0.5 },
        beatA: beat, beatB: beat, fixtures: fx, track: null,
        reactiveEnergy: 0.2 * sensitivity, reactiveAmount: 0.15,
      });
      set({
        live: {
          source: "REKORDBOX",
          bpm: bpm ?? 128,
          beat,
          deckA: { title: "Demo A", section: "CHORUS", countdown: tier ?? "DROP IN 8" },
          deckB: { title: "Demo B", section: "VERSE", countdown: "" },
          cues: vm.upcoming.map((cue) => ({ ...cue, durationBeats: 4, intensity: 0.8, priority: 10 })),
          cells: vm.cells,
        },
      });
    }, 250);
    return () => { clearInterval(timer); };
  }, [running, sensitivity, tier, target, bpm, set]);
  void invoke;
}
