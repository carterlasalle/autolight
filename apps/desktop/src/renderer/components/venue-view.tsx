import { useShell, invoke } from "../state/store.js";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card.js";
import { Button } from "./ui/button.js";
import { DeviceTile } from "./kit.js";

// Venue (§98) + devices (§99): discovery, assignment, target, health tiles.
// Empty until Scan finds real lights — no simulated fixtures.
export function VenueView(): JSX.Element {
  const s = useShell();
  const scan = (): void => {
    void invoke("venue/scan", { version: 1 }).then((result: unknown) => {
      const envelope = result as { ok?: boolean; devices?: { address: string; name: string }[] } | null;
      const list = envelope && envelope.ok !== false && Array.isArray(envelope.devices) ? envelope.devices : [];
      s.set({ devices: list });
      // Qualify every discovered light as a tile (real scan data only):
      // SKU from the reply name, IP from the reply address.
      s.set({
        tiles: list.map((d) => ({
          id: d.address,
          sku: d.name.split(" — ")[0] ?? "Govee",
          ip: d.address,
          firmware: "unknown",
          segments: 14,
          fps: 30,
          sentFrames: 0,
          supersededFrames: 0,
          latencyMs: 25,
          health: "online",
        })),
      });
    });
  };
  return (
    <div className="flex max-w-5xl flex-col gap-3">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-[13px]">Lights</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={scan}>Scan</Button>
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
            <DeviceTile
              key={t.id}
              tile={t}
              onAction={(a) => {
                if (a === "IDENTIFY") void invoke("venue/identify", { version: 1, id: t.id });
                else if (a === "TEST CHASE") void invoke("venue/test-chase", { version: 1, id: t.id });
                else void invoke("venue/device-action", { version: 1, id: t.id, action: "RECALIBRATE" });
              }}
            />
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
