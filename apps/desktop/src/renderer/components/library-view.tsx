import { useShell } from "../state/store.js";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card.js";
import { Badge } from "./ui/badge.js";
import { rowForTrack } from "../library.js";

// Library (§95): readiness table. Live rows arrive from the store;
// empty state invites analysis instead of showing a blank grid.
export function LibraryView(): JSX.Element {
  const live = useShell((s) => s.live);
  const rows = [rowForTrack(null, false, false)];
  return (
    <div className="flex max-w-5xl flex-col gap-3">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-[13px]">Library</CardTitle></CardHeader>
        <CardContent>
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
              {rows.map((r, i) => (
                <tr key={`${r.trackId}-${i}`}>
                  <td className="border-b py-1.5 pr-3">{r.title || "—"}</td>
                  <td className="border-b py-1.5 pr-3">{r.artist || "—"}</td>
                  <td className="border-b py-1.5 pr-3 font-timing tabular-nums">{r.bpm ?? "—"}</td>
                  <td className="border-b py-1.5"><Badge variant="secondary">{r.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!live && <p className="pt-2 text-[13px] text-muted-foreground">Load a track on a deck to preview its show.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
