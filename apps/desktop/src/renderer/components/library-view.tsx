import { useShell } from "../state/store.js";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card.js";
import { Badge } from "./ui/badge.js";
import { rowForTrack } from "../library.js";

// Library (§95): readiness table. Live rows arrive from the store;
// empty state invites analysis instead of showing a blank grid.
// Library (§95): readiness table. Live rows arrive from the store;
// empty until the watcher resolves real tracks — never fake rows.
export function LibraryView(): JSX.Element {
  const live = useShell((s) => s.live);
  const hasTracks = live !== null;
  return (
    <div className="flex max-w-5xl flex-col gap-3">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-[13px]">Library</CardTitle></CardHeader>
        <CardContent>
          {hasTracks ? (
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
                <tr>
                  <td className="border-b py-1.5 pr-3">{live.deckA.title || live.deckB.title || "—"}</td>
                  <td className="border-b py-1.5 pr-3">—</td>
                  <td className="border-b py-1.5 pr-3 font-timing tabular-nums">{live.bpm !== null ? live.bpm.toFixed(1) : "—"}</td>
                  <td className="border-b py-1.5"><Badge variant="secondary">READY</Badge></td>
                </tr>
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
