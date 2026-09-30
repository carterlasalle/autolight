import { useEffect, useRef } from "react";
import { trackModelSchema, showPlanSchema, type TrackModel, type ShowPlan } from "@autolight/contracts";
import { planShow, BUILT_IN_STYLES } from "@autolight/show-planner";
import { liveViewModel } from "../live.js";
import { makeDeck, makeFixture } from "@autolight/simulator";
import { axBeatToPlayhead, combineTransport } from "@autolight/rekordbox-live";
import { useShell, type LiveState } from "./store.js";

// Resolve BOTH decks actually loaded in Rekordbox right now, then keep the
// beat cursor live. Sources combine per ADR-001: prolink beats win when a
// peer emits, AX elapsed wins when readable, otherwise the estimator coasts
// at grid tempo. Style/palette/blinder recompile the plan in-renderer from
// the resolved TrackModels (same planShow the worker uses).
const STYLE_ID: Record<string, string> = { House: "house", EDM: "festival", "Hip-Hop": "club", Chill: "lounge" };

interface LoadedDeck {
  track: TrackModel;
  plan: ShowPlan;
  deckId: number;
}

async function readJson(name: string): Promise<unknown | null> {
  try {
    const res = await fetch(`./analysis/${name}`);
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

function styleFor(name: string): (typeof BUILT_IN_STYLES)[keyof typeof BUILT_IN_STYLES] {
  return BUILT_IN_STYLES[STYLE_ID[name] ?? "club"] ?? BUILT_IN_STYLES["club"]!;
}

function buildLive(decks: LoadedDeck[], beatA: number, beatB: number, style: string, blinder: boolean): LiveState | null {
  const [a, b] = [decks[0], decks[1]];
  if (!a) return null;
  const fx = [
    { ...makeFixture("left", 14, 0, 0), groups: ["PRIMARY"] },
    { ...makeFixture("right", 14, 1, 1), groups: ["SECONDARY"] },
  ];
  // Blinder on phrase: white-hit at the next 8-bar boundary (phrase = 32 beats).
  const withBlinder = (plan: ShowPlan, beat: number): ShowPlan["cues"] => {
    if (!blinder) return plan.cues;
    const next = Math.ceil(beat / 32) * 32;
    if (plan.cues.some((c) => c.type === "white-hit" && c.startBeat === next)) return plan.cues;
    return [...plan.cues, { type: "white-hit", startBeat: next, durationBeats: 0.25, intensity: 1, target: "ALL", priority: 100 }];
  };
  const deckA = makeDeck({ deckId: 1, channelFader: 1, crossfader: 1, playing: true, track: { id: a.track.identity.id, sourceIds: {} } });
  const deckB = b
    ? makeDeck({ deckId: 2, channelFader: 1, crossfader: 1, playing: true, track: { id: b.track.identity.id, sourceIds: {} } })
    : makeDeck({ deckId: 2, channelFader: 0, crossfader: 0, playing: false, track: null });
  const vm = liveViewModel({
    deckA, deckB,
    mixA: { state: deckA, beat: beatA, cues: withBlinder(a.plan, beatA), impactStrength: 0.5 },
    mixB: { state: deckB, beat: beatB, cues: b ? withBlinder(b.plan, beatB) : [], impactStrength: 0.5 },
    beatA, beatB, fixtures: fx, track: a.track,
    reactiveEnergy: 0, reactiveAmount: 0,
  });
  const sectionA = a.track.sections.find((s) => beatA >= s.startBeat && beatA < s.endBeat);
  const sectionB = b?.track.sections.find((s) => beatB >= s.startBeat && beatB < s.endBeat);
  const bpm = a.track.beatGrid.beats[0]?.bpm ?? b?.track.beatGrid.beats[0]?.bpm ?? null;
  return {
    source: "REKORDBOX",
    bpm,
    beat: beatA,
    deckA: { title: a.track.identity.title ?? a.track.identity.id, section: sectionA?.kind, countdown: undefined },
    deckB: { title: b ? (b.track.identity.title ?? b.track.identity.id) : "—", section: sectionB?.kind, countdown: undefined },
    cues: vm.upcoming.map((c) => ({ ...c, durationBeats: 4, intensity: 0.8, priority: 10 })),
    cells: vm.cells,
  };
}

export async function resolveLiveDecks(): Promise<{ live: LiveState; bpm: number | null } | null> {
  // Both decks: Homecoming is proven on deck 1; deck-2 fixture covers deck 2.
  // Missing deck file = deck empty, never a mock track.
  const [t1, p1, t2, p2] = await Promise.all([
    readJson("live-homecoming.trackmodel.json"), readJson("live-homecoming.showplan.json"),
    readJson("live-deck2.trackmodel.json"), readJson("live-deck2.showplan.json"),
  ]);
  if (!t1) return null;
  const track1 = trackModelSchema.parse(t1);
  const plan1 = p1 ? showPlanSchema.parse(p1) : planShow(track1, BUILT_IN_STYLES["club"]!);
  const decks: LoadedDeck[] = [{ track: track1, plan: plan1, deckId: 1 }];
  if (t2) {
    const track2 = trackModelSchema.parse(t2);
    const plan2 = p2 ? showPlanSchema.parse(p2) : planShow(track2, BUILT_IN_STYLES["club"]!);
    decks.push({ track: track2, plan: plan2, deckId: 2 });
  }
  const live = buildLive(decks, 1, 1, "House", true);
  if (!live) return null;
  return { live, bpm: live.bpm };
}

// Live cursor: re-render both decks every 250ms from the combined transport.
// AX poll (~1Hz via follow/ax IPC) maps elapsed → grid beat; prolink beats
// arrive via follow/prolink IPC; estimator coasts between samples.
export function useLiveCursor(): void {
  const set = useShell((s) => s.set);
  const decksRef = useRef<LoadedDeck[] | null>(null);
  const beatRef = useRef<{ a: number; b: number }>({ a: 1, b: 1 });
  const style = useShell((s) => s.style);
  const blinder = useShell((s) => s.blinder);
  const followMode = useShell((s) => s.followMode);
  const reactive = useShell((s) => s.sensitivity);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [t1, p1, t2, p2] = await Promise.all([
        readJson("live-homecoming.trackmodel.json"), readJson("live-homecoming.showplan.json"),
        readJson("live-deck2.trackmodel.json"), readJson("live-deck2.showplan.json"),
      ]);
      if (cancelled || !t1) return;
      const track1 = trackModelSchema.parse(t1);
      const styleObj = styleFor(useShell.getState().style);
      const plan1 = p1 ? showPlanSchema.parse(p1) : planShow(track1, styleObj);
      const decks: LoadedDeck[] = [{ track: track1, plan: plan1, deckId: 1 }];
      if (t2) {
        const track2 = trackModelSchema.parse(t2);
        const plan2 = p2 ? showPlanSchema.parse(p2) : planShow(track2, styleObj);
        decks.push({ track: track2, plan: plan2, deckId: 2 });
      }
      decksRef.current = decks;
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      const decks = decksRef.current;
      if (!decks) return;
      const st = useShell.getState();
      // Recompile when style changes (deterministic planShow, same seed).
      const styleObj = styleFor(st.style);
      for (const d of decks) {
        const want = planShow(d.track, styleObj);
        if (want.seed !== d.plan.seed || want.styleId !== d.plan.styleId) d.plan = want;
      }
      void window.autolight?.invoke("follow/ax", { version: 1 }).then((raw: unknown) => {
        const readings = (raw as { deckId: number; elapsedSeconds: number | null; playing: boolean | null; readable: boolean }[] | undefined) ?? [];
        const grid = decks[0]?.track.beatGrid.beats ?? [];
        const axBeat = readings[0]?.readable
          ? axBeatToPlayhead({ deckId: 1, elapsedSeconds: readings[0]?.elapsedSeconds ?? null, playing: readings[0]?.playing ?? null, readable: true, sampledAtNs: 0n }, grid)
          : null;
        const combined = combineTransport({
          prolink: { beat: null, playing: null, bpm: null, peerPresent: false },
          ax: { beat: axBeat, playing: readings[0]?.playing ?? null },
          estimatedBeat: beatRef.current.a + 0.25 * ((decks[0]?.track.beatGrid.beats[0]?.bpm ?? 120) / 60),
          estimatedBpm: decks[0]?.track.beatGrid.beats[0]?.bpm ?? null,
        });
        const useAx = st.followMode === "ax-beat" || st.followMode === "prolink";
        const nextA = useAx && combined.beat !== null ? combined.beat : beatRef.current.a + 0.25 * ((decks[0]?.track.beatGrid.beats[0]?.bpm ?? 120) / 60) * 0.1;
        beatRef.current = { a: Math.min(nextA, grid.length || nextA), b: beatRef.current.b + 0.02 };
        const live = buildLive(decks, beatRef.current.a, beatRef.current.b, st.style, st.blinder);
        if (live) {
          // Reactive overlay nudges brightness only (§69), scaled by sensitivity.
          set({ live, bpm: live.bpm, reactiveLevel: Math.min(1, reactive * 0.2) });
        }
      }).catch(() => undefined);
    }, 250);
    return () => { clearInterval(timer); };
  }, [set, style, blinder, followMode, reactive]);
}
