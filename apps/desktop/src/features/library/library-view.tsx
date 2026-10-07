import { useEffect, useMemo, useState } from "react";
import type { TrackModel } from "@autolight/contracts";
import { useShell, invoke } from "../../app/store.js";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card.js";
import { Input } from "../../components/ui/input.js";
import { Button } from "../../components/ui/button.js";
import { MetricBadge, StatusDot, deckBpm } from "../../components/kit.js";
import type { StatusTone } from "../../components/kit.js";
import { libraryRowKey } from "../../routes/library/track-key.js";
import {
  advanceQueue, dropFromQueue, libraryTrackRow, prioritiseQueue, queueEntry,
  type LibraryTrackRow, type QueueEntry,
} from "../../routes/library/library-rows.js";

const STATUS_TONE: Record<LibraryTrackRow["status"], StatusTone> = {
  READY: "ok",
  ANALYZING: "neutral",
  "NEEDS ANALYSIS": "warn",
  "GRID WARNING": "warn",
  "SOURCE MISSING": "bad",
  FAILED: "bad",
};

// Library (spec 95) + readiness (spec 137) + preanalysis queue (spec 139).
// Rows come from the resolved show: each row is the measured TrackModel, so
// artist and readiness are real or explicitly unmeasured, never a blank dash
// for every track. Queue persists in the store session; cancel/retry/
// priority are local state transitions the analysis supervisor owns in main.
export function LibraryView(): JSX.Element {
  const live = useShell((s) => s.live);
  const set = useShell((s) => s.set);
  const selected = useShell((s) => s.selectedTrackId);
  const [query, setQuery] = useState("");
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [rows, setRows] = useState<LibraryTrackRow[]>([]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const raw = (await invoke("show/live", { version: 1 })) as unknown as {
          decks?: { track: TrackModel | null }[];
        } | null;
        const decks = raw && Array.isArray(raw.decks) ? raw.decks : [];
        const next = decks.flatMap((d) => d.track === null || d.track === undefined ? [] : [
          libraryTrackRow({
            track: d.track,
            gridWarned: false,
            sourceMissing: false,
            analyzing: false,
            failed: null,
            deepAnalysis: "pending",
            show: "none",
            lastModified: null,
          }),
        ]);
        if (!cancelled) setRows(next);
      } catch { /* show host unreachable: the empty state below stays */ }
    })();
    return () => { cancelled = true; };
  }, [live]);
  const tracks = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? rows.filter((r) => r.title.toLowerCase().includes(q) || r.artist.toLowerCase().includes(q)) : rows;
  }, [rows, query]);
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
                {tracks.map((row) => (
                  <tr
                    key={libraryRowKey({ trackId: row.trackId, title: row.title })}
                    className={selected === row.trackId ? "bg-muted/50" : "cursor-pointer"}
                    onClick={() => { set({ selectedTrackId: row.trackId }); }}
                  >
                    <td className="border-b py-1.5 pr-3">{row.title || "untitled"}</td>
                    <td className="border-b py-1.5 pr-3">{row.artist || "unmeasured"}</td>
                    <td className="border-b py-1.5 pr-3"><MetricBadge metric={{ label: "bpm", value: deckBpm(row.bpm), unit: "" }} /></td>
                    <td className="border-b py-1.5 pr-3">
                      <StatusDot tone={STATUS_TONE[row.status]} label={row.status} title={row.failReason ?? undefined} />
                    </td>
                    <td className="border-b py-1.5">
                      <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); enqueue(row.trackId); }}>Queue</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">No tracks resolved. Load a track on a deck; rows appear after ANLZ and analysis.</p>
              <div>
                <Button size="sm" onClick={() => { set({ route: "setup" }); }}>Open Setup</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Preanalysis queue: {queue.length} queued</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-1.5">
          {queue.length === 0 ? (
            <p className="text-sm text-muted-foreground">Queue a track to analyze it before the set.</p>
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
