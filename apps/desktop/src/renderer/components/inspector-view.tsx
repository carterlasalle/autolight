import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card.js";
import { inspectorLanes } from "../library.js";
import type { InspectorLane } from "../library.js";
import { trackModelSchema } from "@autolight/contracts";
import { useShell } from "../state/store.js";

// Inspector (§96): synchronized beat lanes for the resolved track.
// Loads the committed TrackModel so sections/events/grid are real —
// selected deck row in Library picks which deck inspects.
export function InspectorView(): JSX.Element {
  const selected = useShell((s) => s.selectedTrackId);
  const live = useShell((s) => s.live);
  const [lanes, setLanes] = useState<InspectorLane[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const names = ["live-homecoming.trackmodel.json", "live-deck2.trackmodel.json"];
      for (const name of names) {
        try {
          const res = await fetch(`./analysis/${name}`);
          if (!res.ok) continue;
          const model = trackModelSchema.parse(await res.json());
          const title = model.identity.title ?? model.identity.id;
          if (selected && title !== selected && live && title !== live.deckA.title && title !== live.deckB.title) continue;
          if (!cancelled) setLanes(inspectorLanes(model));
          return;
        } catch { /* try next fixture */ }
      }
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
