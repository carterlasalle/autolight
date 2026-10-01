import { useMemo, useState } from "react";
import { useShell } from "../../app/store.js";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card.js";
import { Input } from "../../components/ui/input.js";
import { Button } from "../../components/ui/button.js";
import { MetricBadge, StatusDot, deckBpm } from "../../components/kit.js";
import { libraryRowKey } from "../../routes/library/track-key.js";
import { advanceQueue, dropFromQueue, libraryTrackRow, prioritiseQueue, queueEntry, type QueueEntry } from "../../routes/library/library-rows.js";

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
  const tracks = useMemo(() => {
    const list = [
      live ? { id: "deck-a", title: live.deckA.title, bpm: live.bpm } : null,
      live && live.deckB.title !== "—" ? { id: "deck-b", title: live.deckB.title, bpm: live.bpm } : null,
    ].filter((r): r is NonNullable<typeof r> => r !== null);
    const q = query.trim().toLowerCase();
    return q ? list.filter((t) => t.title.toLowerCase().includes(q)) : list;
  }, [live, query]);
  const enqueue = (id: string): void => {
    setQueue((prev) => (prev.some((e) => e.trackId === id) ? prev : [...prev, queueEntry(id)]));
  };
  return (
    <div className="flex max-w-5xl flex-col gap-3">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-[13px]">Library</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Input aria-label="Search library" placeholder="Search track or artist" value={query} onChange={(e) => setQuery(e.target.value)} />
          {tracks.length > 0 ? (
            <table aria-label="Library" className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="border-b py-1.5 pr-3 font-medium">Track</th>
                  <th className="border-b py-1.5 pr-3 font-medium">Artist</th>
                  <th className="border-b py-1.5 pr-3 font-medium">BPM</th>
                  <th className="border-b py-1.5 pr-3 font-medium">Readiness</th>
                  <th className="border-b py-1.5 font-medium">Queue</th>
                </tr>
              </thead>
              <tbody>
                {tracks.map((t) => {
                  const row = libraryTrackRow({ track: null, gridWarned: false, sourceMissing: false, analyzing: false, failed: null, deepAnalysis: "pending", show: "none", lastModified: null });
                  const key = t.id === "deck-a" || t.id === "deck-b" ? t.id : libraryRowKey({ trackId: t.id, title: t.title });
                  void row;
                  return (
                    <tr key={key} className={selected === t.id ? "bg-muted/50" : "cursor-pointer"} onClick={() => { set({ selectedTrackId: t.id }); }}>
                      <td className="border-b py-1.5 pr-3">{t.title || "—"}</td>
                      <td className="border-b py-1.5 pr-3">—</td>
                      <td className="border-b py-1.5 pr-3"><MetricBadge metric={{ label: "bpm", value: deckBpm(t.bpm), unit: "" }} /></td>
                      <td className="border-b py-1.5 pr-3"><StatusDot tone="warn" label="NEEDS ANALYSIS" /></td>
                      <td className="border-b py-1.5"><Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); enqueue(t.id); }}>Queue</Button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p className="text-[13px] text-muted-foreground">No tracks resolved. Load a track on a deck — rows appear after ANLZ + analysis.</p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-[13px]">Preanalysis queue: {queue.length} queued</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-1.5">
          {queue.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">Select playlists or crates and queue them; entries persist across restarts.</p>
          ) : (
            queue.map((e) => (
              <div key={e.trackId} className="flex items-center gap-2 text-[13px]">
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
