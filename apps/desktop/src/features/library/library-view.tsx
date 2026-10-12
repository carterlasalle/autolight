import { useMemo, useState } from "react";
import { useShell } from "../../app/store.js";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card.js";
import { Input } from "../../components/ui/input.js";
import { Button } from "../../components/ui/button.js";
import { MetricBadge, StatusDot, deckBpm } from "../../components/kit.js";
import { libraryRowKey } from "../../routes/library/track-key.js";
import { advanceQueue, dropFromQueue, liveDeckRows, prioritiseQueue, queueEntry, type QueueEntry } from "../../routes/library/library-rows.js";

// Library (spec 95) + readiness (spec 137) + preanalysis queue (spec 139).
// Rows come from the resolved show: keyed by TrackId via track-key.ts, never
// by title. Queue persists in the store session; cancel/retry/priority are
// local state transitions the analysis supervisor owns in main.
export function LibraryView(): JSX.Element {
  const live = useShell((s) => s.live);
  const set = useShell((s) => s.set);
  const selected = useShell((s) => s.selectedTrackId);
  const [query, setQuery] = useState("");
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const tracks = useMemo(() => (
    live ? liveDeckRows([live.deckA, live.deckB], live.bpm, query) : []
  ), [live, query]);
  const enqueue = (id: string): void => {
    setQueue((prev) => (prev.some((e) => e.trackId === id) ? prev : [...prev, queueEntry(id)]));
  };
  return (
    <div className="flex max-w-5xl flex-col gap-3">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Library</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Input aria-label="Search library" placeholder="Search track or artist" value={query} onChange={(e) => setQuery(e.target.value)} />
          {tracks.length > 0 ? (
            <table aria-label="Library" className="w-full border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th scope="col" className="border-b py-1.5 pr-3 font-medium">Track</th>
                  <th scope="col" className="border-b py-1.5 pr-3 font-medium">Artist</th>
                  <th scope="col" className="border-b py-1.5 pr-3 font-medium">BPM</th>
                  <th scope="col" className="border-b py-1.5 pr-3 font-medium">Readiness</th>
                  <th scope="col" className="border-b py-1.5 font-medium"><span className="sr-only">Queue actions</span></th>
                </tr>
              </thead>
              <tbody>
                {tracks.map((t) => {
                  const key = t.id === "deck-a" || t.id === "deck-b" ? t.id : libraryRowKey({ trackId: t.id, title: t.title });
                  const ready = t.readiness === "READY";
                  return (
                    <tr key={key} className={selected === t.id ? "bg-muted/50" : "cursor-pointer"} onClick={() => { set({ selectedTrackId: t.id }); }}>
                      <td className="border-b py-1.5 pr-3">{t.title || "—"}</td>
                      <td className="border-b py-1.5 pr-3">{t.artist || "unknown artist"}</td>
                      <td className="border-b py-1.5 pr-3"><MetricBadge metric={{ label: "bpm", value: t.bpm === null ? null : deckBpm(t.bpm), unit: "" }} /></td>
                      <td className="border-b py-1.5 pr-3"><StatusDot tone={ready ? "ok" : "warn"} label={t.readiness} /></td>
                      <td className="border-b py-1.5"><Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); enqueue(t.id); }}>Queue</Button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="flex flex-col items-start gap-2">
              <p className="text-sm text-muted-foreground">No tracks resolved. Load a track on a deck — rows appear after ANLZ + analysis.</p>
              <Button size="sm" variant="outline" onClick={() => { set({ route: "setup" }); }}>Open Setup</Button>
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Preanalysis queue: {queue.length} queued</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-1.5">
          {queue.length === 0 ? (
            <p className="text-sm text-muted-foreground">Select playlists or crates and queue them; entries persist across restarts.</p>
          ) : (
            queue.map((e) => (
              <div key={e.trackId} className="flex items-center gap-2 text-sm">
                <span>{e.trackId}</span>
                <span className="text-muted-foreground">{e.state}{e.priority ? " · priority" : ""}</span>
                <Button size="sm" variant="outline" onClick={() => setQueue((prev) => prioritiseQueue(prev, e.trackId))}>Priority</Button>
                <Button size="sm" variant="outline" onClick={() => setQueue((prev) => advanceQueue(prev, e.trackId, "Failed", 1, "cancelled by owner"))}>Cancel</Button>
                <Button size="sm" variant="outline" onClick={() => setQueue((prev) => advanceQueue(prev, e.trackId, "Queued", 0, null))}>Retry</Button>
                <Button size="sm" variant="outline" onClick={() => setQueue((prev) => dropFromQueue(prev, e.trackId))}>Remove</Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
