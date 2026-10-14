import { useEffect, useRef } from "react";
import type { TrackModel, ShowPlan } from "@autolight/contracts";
import { coverageOf } from "@autolight/track-model";
import { planShow, BUILT_IN_STYLES } from "@autolight/show-planner";
import { liveViewModel } from "../features/live/live.js";
import type { DeckState, Fixture } from "@autolight/contracts";
// Browser-safe follow math only (./follow.js has no node: imports). Never
// import the package barrel here: it re-exports the UDP providers and
// blank-screens `yarn dev` (node:dgram externalized).
import { axBeatToPlayhead, combineTransport } from "@autolight/rekordbox-live/follow";
import { trackPalette } from "../routes/live/manual-intents.js";
import { useShell, invoke, type LiveState } from "./store.js";

// Live deck resolution (T-TRU-02): production path reads DeckState and
// installed TrackModel plus ShowPlan from the show host over typed IPC.
// No fixture fetch, no hardcoded track. Empty decks produce empty states.
// Simulator mode supplies simulated providers through the same IPC surface.
const STYLE_ID: Record<string, string> = { House: "house", EDM: "festival", "Hip-Hop": "club", Chill: "lounge" };

interface LoadedDeck {
  track: TrackModel;
  plan: ShowPlan;
  state: DeckState;
}

interface ShowLiveResponse {
  decks: { state: DeckState; track: TrackModel | null; plan: ShowPlan | null }[];
  fixtures: Fixture[];
}

function styleFor(name: string): (typeof BUILT_IN_STYLES)[keyof typeof BUILT_IN_STYLES] {
  return BUILT_IN_STYLES[STYLE_ID[name] ?? "club"] ?? BUILT_IN_STYLES["club"]!;
}

/** Beat at which a style chosen at `beat` may take over: the next phrase boundary. */
export function phraseBoundaryAfter(beat: number, phrase = 32): number {
  return Math.floor(beat / phrase) * phrase + phrase;
}

/**
 * Pending-style decision: arm once (a live beat is fractional, so an exact
 * multiple of the phrase never lands) then apply on the first crossing.
 */
export function pendingStyleDue(beat: number, boundary: number | null): { due: boolean; next: number | null } {
  const armed = boundary ?? phraseBoundaryAfter(beat);

  return beat >= armed ? { due: true, next: null } : { due: false, next: armed };
}

function deckSnapshot(track: TrackModel | null, deck: { effectiveBpm: number | null } | null, section: string | undefined): { title: string; artist: string; readiness: "READY" | "NEEDS ANALYSIS"; bpm: number | null; section: string | undefined; countdown: undefined } {
  const bpm = deck?.effectiveBpm ?? track?.beatGrid.beats[0]?.bpm ?? null;

  if (!track) return { title: "—", artist: "", readiness: "NEEDS ANALYSIS", bpm, section, countdown: undefined };

  return {
    title: track.identity.title ?? track.identity.id,
    artist: track.identity.artist ?? "",
    readiness: coverageOf(track) === "adaptive" ? "NEEDS ANALYSIS" : "READY",
    bpm,
    section,
    countdown: undefined,
  };
}

export function buildLive(decks: LoadedDeck[], fixtures: Fixture[], blinder: boolean, beat?: { a: number; b: number }): LiveState | null {
  const [a, b] = [decks[0], decks[1]];

  if (!a) return null;

  const withBlinder = (plan: ShowPlan, beat: number): ShowPlan["cues"] => {
    if (!blinder) return plan.cues;
    const next = Math.ceil(beat / 32) * 32;

    if (plan.cues.some((c) => c.type === "white-hit" && c.startBeat === next)) return plan.cues;

    return [...plan.cues, { type: "white-hit", startBeat: next, durationBeats: 0.25, intensity: 1, target: "ALL", priority: 100 }];
  };

  // AL-FLOW-003: the live cursor's computed beat (AX-corrected, estimated
  // between polls) is the render beat. The fetch-time snapshot only seeds
  // the one-shot path; previously the computed beat died in beatRef.
  const beatA = beat?.a ?? a.state.playheadSeconds;
  const beatB = beat?.b ?? b?.state.playheadSeconds ?? 1;
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
    deckA: deckSnapshot(a.track, deckA, sectionA?.kind),
    deckB: b ? deckSnapshot(b.track, deckB, sectionB?.kind) : { title: "—", artist: "", readiness: "NEEDS ANALYSIS" as const, bpm: null, section: undefined, countdown: undefined },
    cues: vm.upcoming.map((c) => ({ ...c, durationBeats: 4, intensity: 0.8, priority: 10 })),
    cells: vm.cells,
    palette: deckPalette(a.track, b?.track ?? null),
  };
}

// Swatch set for the manual lane: deck A's palette first, deck B fills gaps,
// deduped by colour; empty leaves the lane on its basic swatches.
function deckPalette(a: TrackModel, b: TrackModel | null): [number, number, number][] {
  const out: [number, number, number][] = [];
  const seen = new Set<string>();

  for (const track of [a, b]) {
    if (!track) continue;

    for (const rgb of trackPalette(track)) {
      const key = rgb.join(",");

      if (seen.has(key)) continue;
      seen.add(key);
      out.push(rgb);
    }
  }

  return out;
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
    if (d.track && d.plan) loaded.push({ track: d.track, plan: d.plan, state: d.state });
  }

  if (loaded.length === 0) return null;
  const st = useShell.getState();
  const live = buildLive(loaded, snap.fixtures, st.blinder);

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
  const renderDecksRef = useRef<LoadedDeck[]>([]);
  const plannedStyleRef = useRef<string | null>(null);
  const axRef = useRef<{ beat: number | null; playing: boolean | null }>({ beat: null, playing: null });
  const pendingBoundaryRef = useRef<number | null>(null);
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
        if (d.track && d.plan) loaded.push({ track: d.track, plan: d.plan, state: d.state });
      }

      if (loaded.length === 0) return;
      decksRef.current = loaded;
      plannedStyleRef.current = null;
      fixturesRef.current = snap.fixtures;
      beatRef.current = {
        a: loaded[0]?.state.playheadSeconds ?? 1,
        b: loaded[1]?.state.playheadSeconds ?? 1,
      };
    })();

    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    // AL-LIFE-004: the mount fetch can land before decks exist. The cursor
    // refetches while empty (guarded against overlap) so tracks loaded
    // after mount still appear — no blind return, no subscription bus.
    let refetching = false;
    let axInFlight = false;

    const timer = setInterval(() => {
      const decks = decksRef.current;

      if (!decks || decks.length === 0) {
        if (refetching) return;
        refetching = true;
        void fetchShowLive().then((snap) => {
          refetching = false;

          if (!snap) return;
          const loaded: LoadedDeck[] = [];

          for (const d of snap.decks) {
            if (d.track && d.plan) loaded.push({ track: d.track, plan: d.plan, state: d.state });
          }

          if (loaded.length === 0) return;

          decksRef.current = loaded;
          plannedStyleRef.current = null;
          fixturesRef.current = snap.fixtures;
          beatRef.current = {
            a: loaded[0]?.state.playheadSeconds ?? 1,
            b: loaded[1]?.state.playheadSeconds ?? 1,
          };
        });

        return;

      }

      const st = useShell.getState();

      const styleObj = styleFor(st.style);

      // Compile only when the style actually changes; the host's loaded plan
      // stays immutable and the cursor renders from a style-scoped copy.
      if (plannedStyleRef.current !== styleObj.id) {
        renderDecksRef.current = decks.map((d) => ({ ...d, plan: planShow(d.track, styleObj) }));
        plannedStyleRef.current = styleObj.id;
      }

      const renderDecks = renderDecksRef.current;
      const grid = renderDecks[0]?.track.beatGrid.beats ?? [];
      const bpmA = renderDecks[0]?.track.beatGrid.beats[0]?.bpm ?? 120;

      // Guard the ~1Hz AX poll against overlapping with the 250ms tick: a slow
      // round trip must not write a stale beat after a newer one landed.
      if (!axInFlight) {
        axInFlight = true;
        void (invoke("follow/ax", { version: 1 }) as Promise<unknown>).then((raw: unknown) => {
          axInFlight = false;
          const envelope = raw as { ok?: boolean; readings?: { deckId: number; elapsedSeconds: number | null; playing: boolean | null; readable: boolean }[] } | null;
          const readings = envelope && envelope.ok !== false && Array.isArray(envelope.readings) ? envelope.readings : [];

          axRef.current = {
            beat: readings[0]?.readable
              ? axBeatToPlayhead({ deckId: 1, elapsedSeconds: readings[0]?.elapsedSeconds ?? null, playing: readings[0]?.playing ?? null, readable: true, sampledAtNs: 0n }, grid)
              : null,
            playing: readings[0]?.playing ?? null,
          };
        });
      }

      const ax = axRef.current;

      const combined = combineTransport({
        prolink: { beat: null, playing: null, bpm: null, peerPresent: false },
        ax: { beat: ax.beat, playing: ax.playing },
        estimatedBeat: beatRef.current.a + 0.25 * (bpmA / 60),
        estimatedBpm: renderDecks[0]?.track.beatGrid.beats[0]?.bpm ?? null,
      });

      const useAx = st.followMode === "ax-beat" || st.followMode === "prolink";
      const nextA = useAx && combined.beat !== null ? combined.beat : beatRef.current.a + 0.25 * (bpmA / 60);
      const deckB = renderDecks[1];
      const bpmB = deckB?.state.effectiveBpm ?? deckB?.track.beatGrid.beats[0]?.bpm ?? 120;
      const nextB = deckB?.state.playing ? beatRef.current.b + 0.25 * (bpmB / 60) : beatRef.current.b;

      beatRef.current = { a: nextA, b: nextB };
      const live = buildLive(renderDecks, fixturesRef.current, st.blinder, beatRef.current);

      if (live) {
        set({ live, bpm: live.bpm, reactiveLevel: Math.min(1, reactive * 0.2), liveBeat: live.beat ?? 0 });

        if (st.pendingStyle !== null && st.pendingStyle !== st.style) {
          const decision = pendingStyleDue(live.beat ?? 0, pendingBoundaryRef.current);

          pendingBoundaryRef.current = decision.next;

          if (decision.due) set({ style: st.pendingStyle, pendingStyle: null });
        } else {
          pendingBoundaryRef.current = null;
        }
      }
    }, 250);

    return () => { clearInterval(timer); };
  }, [set, style, blinder, followMode, reactive]);
}
