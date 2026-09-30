import { useShell, invoke } from "../state/store.js";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card.js";
import { Button } from "./ui/button.js";
import { Badge } from "./ui/badge.js";
import { tileForFixture } from "../venue.js";
import { makeFixture } from "@autolight/simulator";

// Venue (§98) + devices (§99): discovery, assignment, target, health tiles.
// Empty until Scan finds real lights — no simulated fixtures.
export function VenueView(): JSX.Element {
  const s = useShell();
  return (
    <div className="flex max-w-5xl flex-col gap-3">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-[13px]">Lights</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm" variant="outline"
              onClick={() => {
                void invoke("venue/list", { version: 1 }).then((result: unknown) => {
                  const list = (result as { devices?: { address: string; name: string }[] } | undefined)?.devices ?? [];
                  s.set({ devices: list });
                });
              }}
            >
              Scan
            </Button>
            <span className="text-[13px] text-muted-foreground">
              {s.devices.length === 0 ? "No lights found — Scan the LAN." : `${s.devices.length} found`}
            </span>
            <div className="flex gap-3" role="radiogroup" aria-label="Control target">
              {(["A", "B", "Both"] as const).map((t) => (
                <label key={t} className="flex items-center gap-1.5 text-[13px]">
                  <input type="radio" name="target" checked={s.target === t} onChange={() => { s.set({ target: t }); }} />
                  {t === "Both" ? "Both" : t}
                </label>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
      {s.tiles.length > 0 ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
          {s.tiles.map((t) => (
            <Card key={t.id}>
              <CardHeader className="pb-1">
                <CardTitle className="flex items-center gap-2 text-sm">
                  {t.id} <span className="font-normal text-muted-foreground">({t.sku})</span>
                  <Badge variant={t.health === "online" ? "default" : "secondary"} className="ml-auto">{t.health}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="font-timing text-xs tabular-nums text-muted-foreground">
                  {t.fps}fps · {t.segments} segs · {t.latencyMs}ms
                </p>
                <div className="flex gap-2">
                  {(["IDENTIFY", "TEST CHASE", "RECALIBRATE"] as const).map((a) => (
                    <Button
                      key={a} size="sm" variant="outline"
                      onClick={() => { void invoke("venue/device-action", { version: 1, id: t.id, action: a }); }}
                    >
                      {a}
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="pt-4">
            <p className="text-[13px] text-muted-foreground">No fixtures qualified yet. Scan, then run IDENTIFY + TEST CHASE per light.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
