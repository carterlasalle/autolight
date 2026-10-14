import { useMemo, useState } from "react";
import { useShell } from "../../app/store.js";
import { Input } from "../../components/ui/input.js";
import { Button } from "../../components/ui/button.js";
import { MetricBadge, StatusDot, deckBpm } from "../../components/kit.js";
import { advanceQueue, dropFromQueue, liveDeckRows, prioritiseQueue, queueEntry, type QueueEntry } from "../../routes/library/library-rows.js";

// Library (spec 95) + readiness (spec 137) + preanalysis queue (spec 139).
// Rows come from the resolved show: keyed by the deck row ids, never by
// title. The queue below is this view's own session draft of what to submit;
// the analysis supervisor in main owns the real job states and persistence.
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
      <section className="rounded-xl border border-border bg-card px-4 py-3">
        <h2 className="text-base font-medium">Library</h2>
        <div className="mt-2 flex min-w-0 flex-col gap-2">
          <Input aria-label="Search library" placeholder="Search track or artist" value={query} onChange={(e) => setQuery(e.target.value)} />
          {tracks.length > 0 ? (
            <div className="min-w-0 overflow-x-auto">
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
                <tbody className="tabular-nums">
                  {tracks.map((t) => {
                    // Deck row ids are the stable keys; the previous
                    // libraryRowKey fallback was unreachable for this row
                    // type (batch-22).
                    const key = t.id;
                    const ready = t.readiness === "READY";

                    return (
                      <tr key={key} className={selected === t.id ? "bg-muted/50" : "cursor-pointer"} onClick={() => { set({ selectedTrackId: t.id }); }}>
                        <td className="max-w-64 truncate border-b py-1.5 pr-3" title={t.title || "—"}>{t.title || "—"}</td>
                        <td className="max-w-48 truncate border-b py-1.5 pr-3" title={t.artist || "unknown artist"}>{t.artist || "unknown artist"}</td>
                        <td className="border-b py-1.5 pr-3"><MetricBadge metric={{ label: "bpm", value: t.bpm === null ? null : deckBpm(t.bpm), unit: "" }} /></td>
                        <td className="border-b py-1.5 pr-3"><StatusDot tone={ready ? "ok" : "warn"} label={t.readiness} /></td>
                        <td className="border-b py-1.5"><Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); enqueue(t.id); }}>Queue</Button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex min-w-0 flex-col items-start gap-2">
              {query.trim() !== "" ? (
                <>
                  <p className="min-w-0 text-sm text-muted-foreground">No rows match “{query.trim()}”.</p>
                  <Button size="sm" variant="outline" onClick={() => { setQuery(""); }}>Clear search</Button>
                </>
              ) : (
                <>
                  <p className="min-w-0 text-sm text-muted-foreground">No tracks resolved. Load a track on a deck — rows appear after ANLZ + analysis.</p>
                  <Button size="sm" variant="outline" onClick={() => { set({ route: "setup" }); }}>Open Setup</Button>
                </>
              )}
            </div>
          )}
        </div>
      </section>
      <section className="rounded-xl border border-border bg-card px-4 py-3">
        <h2 className="text-base font-medium">Preanalysis queue: {queue.length} queued</h2>
        <div className="mt-2 flex min-w-0 flex-col gap-1.5">
          {queue.length === 0 ? (
            <p className="min-w-0 text-sm text-muted-foreground">Select playlists or crates and queue them; the queue is a session draft — the analysis supervisor owns the real job states.</p>
          ) : (
            queue.map((e) => (
              <div key={e.trackId} className="flex min-w-0 items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate" title={e.trackId}>{e.trackId}</span>
                <span className="shrink-0 text-muted-foreground">{e.state}{e.priority ? " · priority" : ""}</span>
                <Button size="sm" variant="outline" onClick={() => setQueue((prev) => prioritiseQueue(prev, e.trackId))}>Priority</Button>
                {/* Cancel only while there is something to cancel and Retry
                    only for a failure: forcing Failed onto Ready (or Queued
                    onto an analyzing run) would rewind a finished job
                    (batch-22). */}
                <Button size="sm" variant="outline" disabled={e.state === "Ready" || e.state === "Failed"} onClick={() => setQueue((prev) => advanceQueue(prev, e.trackId, "Failed", 1, "cancelled by owner"))}>Cancel</Button>
                <Button size="sm" variant="outline" disabled={e.state !== "Failed"} onClick={() => setQueue((prev) => advanceQueue(prev, e.trackId, "Queued", 0, null))}>Retry</Button>
                <Button size="sm" variant="outline" onClick={() => setQueue((prev) => dropFromQueue(prev, e.trackId))}>Remove</Button>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
