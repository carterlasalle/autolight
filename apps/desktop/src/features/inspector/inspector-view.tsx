import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card.js";
import { InspectorPanel } from "../../components/kit.js";
import type { TrackModel } from "@autolight/contracts";
import { useShell, invoke } from "../../app/store.js";
// Inspector: synchronized beat lanes for the resolved track.
// Loads the installed TrackModel from the show host over typed IPC,
// never from fixture files. Selected deck row in Library picks the deck.
export function InspectorView(): JSX.Element {
  const selected = useShell((s) => s.selectedTrackId);
  const live = useShell((s) => s.live);
  const [track, setTrack] = useState<TrackModel | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const raw = (await invoke("show/live", { version: 1 })) as unknown as {
          decks: { state: { deckId: number }; track: TrackModel | null }[];
        } | null;
        const decks = raw && Array.isArray(raw.decks) ? raw.decks : [];
        for (const d of decks) {
          if (!d.track) continue;
          const title = d.track.identity.title ?? d.track.identity.id;
          if (selected && title !== selected && live && title !== live.deckA.title && title !== live.deckB.title) continue;
          if (!cancelled) { setLoaded(true); setTrack(d.track); return; }
        }
        if (!cancelled) { setLoaded(true); setTrack(null); }
      } catch { /* show host unreachable: empty lanes below */ }
      if (!cancelled) { setLoaded(true); setTrack(null); }
    })();
    return () => { cancelled = true; };
  }, [selected, live]);
  return (
    <div className="flex max-w-5xl flex-col gap-3">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-[13px]">Track inspector{selected ? ` — ${selected}` : ""}</CardTitle></CardHeader>
        <CardContent>
          {!loaded ? (
            <p className="text-[13px] text-muted-foreground">Loading lanes…</p>
          ) : track === null ? (
            <p className="text-[13px] text-muted-foreground">No track analyzed yet. Lanes for waveform, grid, sections, events, and cues appear after the analysis worker finishes a loaded deck.</p>
          ) : (
            <InspectorPanel
              track={track}
              startBeat={0}
              endBeat={Math.max(1, ...track.sections.map((s) => s.endBeat), ...track.musicalEvents.map((e) => e.beat))}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
