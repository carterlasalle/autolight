import { useShell } from "../../app/store.js";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card.js";
import { MetricBadge, StatusDot, deckBpm } from "../../components/kit.js";

// Library (§95): readiness table. Live rows arrive from the store;
// empty state invites analysis instead of showing a blank grid.
// Library (§95): readiness table. Live rows arrive from the store;
// empty until the watcher resolves real tracks — never fake rows.
export function LibraryView(): JSX.Element {
  const live = useShell((s) => s.live);
  const set = useShell((s) => s.set);
  const selected = useShell((s) => s.selectedTrackId);
  const rows = [
    live ? { deck: 1 as const, title: live.deckA.title, bpm: live.bpm, id: live.deckA.title } : null,
    live && live.deckB.title !== "—" ? { deck: 2 as const, title: live.deckB.title, bpm: live.bpm, id: live.deckB.title } : null,
  ].filter((r): r is NonNullable<typeof r> => r !== null);
  return (
    <div className="flex max-w-5xl flex-col gap-3">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-[13px]">Library</CardTitle></CardHeader>
        <CardContent>
          {rows.length > 0 ? (
            <table aria-label="Library" className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="border-b py-1.5 pr-3 font-medium">Track</th>
                  <th className="border-b py-1.5 pr-3 font-medium">Artist</th>
                  <th className="border-b py-1.5 pr-3 font-medium">BPM</th>
                  <th className="border-b py-1.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={`${r.deck}-${r.id}`}
                    className={selected === r.id ? "bg-muted/50" : "cursor-pointer"}
                    onClick={() => { set({ selectedTrackId: r.id }); }}
                  >
                    <td className="border-b py-1.5 pr-3">{r.title || "—"}</td>
                    <td className="border-b py-1.5 pr-3">—</td>
                    <td className="border-b py-1.5 pr-3"><MetricBadge metric={{ label: "bpm", value: deckBpm(r.bpm), unit: "" }} /></td>
                    <td className="border-b py-1.5"><StatusDot tone="ok" label="READY" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-[13px] text-muted-foreground">No tracks resolved. Load a track on a deck — rows appear after ANLZ + analysis.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
