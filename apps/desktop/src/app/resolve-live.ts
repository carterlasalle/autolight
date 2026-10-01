import { useEffect, useRef } from "react";
import type { TrackModel, ShowPlan } from "@autolight/contracts";
import { planShow, BUILT_IN_STYLES } from "@autolight/show-planner";
import { liveViewModel } from "../features/live/live.js";
import type { DeckState, Fixture } from "@autolight/contracts";
import { axBeatToPlayhead, combineTransport } from "@autolight/rekordbox-live";
import { useShell, invoke, type LiveState } from "./store.js";
// Live deck resolution (T-TRU-02): production path reads DeckState and
// installed TrackModel plus ShowPlan from the show host over typed IPC.
// No fixture fetch, no hardcoded track. Empty decks produce empty states.
// Simulator mode supplies simulated providers through the same IPC surface.
const STYLE_ID: Record<string, string> = { House: "house", EDM: "festival", "Hip-Hop": "club", Chill: "lounge" };

interface LoadedDeck {
  track: TrackModel;
  plan: ShowPlan;
  deckId: number;
  state: DeckState;
}

interface ShowLiveResponse {
  decks: { state: DeckState; track: TrackModel | null; plan: ShowPlan | null }[];
  fixtures: Fixture[];
}

function styleFor(name: string): (typeof BUILT_IN_STYLES)[keyof typeof BUILT_IN_STYLES] {
  return BUILT_IN_STYLES[STYLE_ID[name] ?? "club"] ?? BUILT_IN_STYLES["club"]!;
}

function buildLive(decks: LoadedDeck[], fixtures: Fixture[], style: string, blinder: boolean): LiveState | null {
  const [a, b] = [decks[0], decks[1]];
  if (!a) return null;
  const withBlinder = (plan: ShowPlan, beat: number): ShowPlan["cues"] => {
    if (!blinder) return plan.cues;
    const next = Math.ceil(beat / 32) * 32;
    if (plan.cues.some((c) => c.type === "white-hit" && c.startBeat === next)) return plan.cues;
    return [...plan.cues, { type: "white-hit", startBeat: next, durationBeats: 0.25, intensity: 1, target: "ALL", priority: 100 }];
  };
  const beatA = a.state.playheadSeconds;
  const beatB = b?.state.playheadSeconds ?? 1;
  const deckA = a.state;
  const deckB = b?.state ?? {
    source: "rekordbox" as const, deckId: 2, track: null, playing: false,
    playheadSeconds: 0, playRate: 1, effectiveBpm: null,
    loop: { active: false, startSeconds: null, endSeconds: null, beatLength: null },
    channelFader: 0, crossfader: 0, master: null, receivedAtNs: 0n,
  };
  const vm = liveViewModel({
    deckA, deckB,
    mixA: { state: deckA, beat: beatA, cues: withBlinder(a.plan, beatA), impactStrength: 0.5 },
    mixB: { state: deckB, beat: beatB, cues: b ? withBlinder(b.plan, beatB) : [], impactStrength: 0.5 },
    beatA, beatB, fixtures, track: a.track,
    reactiveEnergy: 0, reactiveAmount: 0,
  });
  const sectionA = a.track.sections.find((s) => beatA >= s.startBeat && beatA < s.endBeat);
  const sectionB = b?.track.sections.find((s) => beatB >= s.startBeat && beatB < s.endBeat);
  const bpm = deckA.effectiveBpm ?? a.track.beatGrid.beats[0]?.bpm ?? null;
  return {
    source: deckA.source === "serato" ? "SERATO" : "REKORDBOX",
    bpm,
    beat: beatA,
    deckA: { title: a.track.identity.title ?? a.track.identity.id, section: sectionA?.kind, countdown: undefined },
    deckB: { title: b ? (b.track.identity.title ?? b.track.identity.id) : "—", section: sectionB?.kind, countdown: undefined },
    cues: vm.upcoming.map((c) => ({ ...c, durationBeats: 4, intensity: 0.8, priority: 10 })),
    cells: vm.cells,
  };
}

async function fetchShowLive(): Promise<ShowLiveResponse | null> {
  const raw = (await invoke("show/live", { version: 1 })) as unknown as ({ ok?: boolean } & ShowLiveResponse) | null;
  if (!raw || raw.ok === false || !Array.isArray(raw.decks)) return null;
  return raw;
}

export async function resolveLiveDecks(): Promise<{ live: LiveState; bpm: number | null } | null> {
  const snap = await fetchShowLive();
  if (!snap) return null;
  const loaded: LoadedDeck[] = [];
  for (const d of snap.decks) {
    if (d.track && d.plan) loaded.push({ track: d.track, plan: d.plan, deckId: d.state.deckId, state: d.state });
  }
  if (loaded.length === 0) return null;
  const st = useShell.getState();
  const live = buildLive(loaded, snap.fixtures, st.style, st.blinder);
  if (!live) return null;
  return { live, bpm: live.bpm };
}

// Live cursor: re-render both decks every 250ms from the combined transport.
// AX poll (~1Hz via follow/ax IPC) maps elapsed to grid beat; prolink beats
// arrive via follow/prolink IPC; estimator coasts between samples.
export function useLiveCursor(): void {
  const set = useShell((s) => s.set);
  const decksRef = useRef<LoadedDeck[] | null>(null);
  const fixturesRef = useRef<Fixture[]>([]);
  const beatRef = useRef<{ a: number; b: number }>({ a: 1, b: 1 });
  const style = useShell((s) => s.style);
  const blinder = useShell((s) => s.blinder);
  const followMode = useShell((s) => s.followMode);
  const reactive = useShell((s) => s.sensitivity);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const snap = await fetchShowLive();
      if (cancelled || !snap) return;
      const loaded: LoadedDeck[] = [];
      for (const d of snap.decks) {
        if (d.track && d.plan) loaded.push({ track: d.track, plan: d.plan, deckId: d.state.deckId, state: d.state });
      }
      if (loaded.length === 0) return;
      decksRef.current = loaded;
      fixturesRef.current = snap.fixtures;
      beatRef.current = {
        a: loaded[0]?.state.playheadSeconds ?? 1,
        b: loaded[1]?.state.playheadSeconds ?? 1,
      };
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      const decks = decksRef.current;
      if (!decks || decks.length === 0) return;
      const st = useShell.getState();
      const styleObj = styleFor(st.style);
      for (const d of decks) {
        const want = planShow(d.track, styleObj);
        if (want.seed !== d.plan.seed || want.styleId !== d.plan.styleId) d.plan = want;
      }
      void (invoke("follow/ax", { version: 1 }) as Promise<unknown>).then((raw: unknown) => {
        const envelope = raw as { ok?: boolean; readings?: { deckId: number; elapsedSeconds: number | null; playing: boolean | null; readable: boolean }[] } | null;
        const readings = envelope && envelope.ok !== false && Array.isArray(envelope.readings) ? envelope.readings : [];
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
        const live = buildLive(decks, fixturesRef.current, st.style, st.blinder);
        if (live) {
          set({ live, bpm: live.bpm, reactiveLevel: Math.min(1, reactive * 0.2) });
        }
      });
    }, 250);
    return () => { clearInterval(timer); };
  }, [set, style, blinder, followMode, reactive]);
}
