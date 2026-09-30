import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card.js";
import { inspectorLanes } from "../library.js";
import type { InspectorLane } from "../library.js";
import type { TrackModel } from "@autolight/contracts";
import { useShell, invoke } from "../state/store.js";
// Inspector: synchronized beat lanes for the resolved track.
// Loads the installed TrackModel from the show host over typed IPC,
// never from fixture files. Selected deck row in Library picks the deck.
export function InspectorView(): JSX.Element {
  const selected = useShell((s) => s.selectedTrackId);
  const live = useShell((s) => s.live);
  const [lanes, setLanes] = useState<InspectorLane[] | null>(null);
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
          if (!cancelled) setLanes(inspectorLanes(d.track));
          return;
        }
      } catch { /* show host unreachable: empty lanes below */ }
      if (!cancelled) setLanes([]);
    })();
    return () => { cancelled = true; };
  }, [selected, live]);
  return (
    <div className="flex max-w-5xl flex-col gap-3">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-[13px]">Track inspector{selected ? ` — ${selected}` : ""}</CardTitle></CardHeader>
        <CardContent>
          {lanes === null ? (
            <p className="text-[13px] text-muted-foreground">Loading lanes…</p>
          ) : lanes.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">No track analyzed yet. Lanes for waveform, grid, sections, events, and cues appear after the analysis worker finishes a loaded deck.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {lanes.map((lane) => (
                <div key={lane.name}>
                  <p className="text-xs font-medium text-muted-foreground">{lane.name} ({lane.beats.length})</p>
                  <p className="font-timing text-xs tabular-nums">{lane.beats.slice(0, 24).map((b) => String(b ?? "·")).join(" ")}{lane.beats.length > 24 ? " …" : ""}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
