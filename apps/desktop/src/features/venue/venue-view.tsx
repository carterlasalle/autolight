import { useState } from "react";
import { useShell, invoke } from "../../app/store.js";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card.js";
import { Button } from "../../components/ui/button.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select.js";
import { DeviceTile } from "../../components/kit.js";
import { deviceScreenRow, withTransportMode, type TransportMode } from "../../routes/venue/device-screens.js";

// Venue (spec 98 ops live in the WP05 room editor under routes/venue/) +
// Device screen (spec 99): tiles with measured-or-unmeasured fields plus the
// transport mode dropdown. Empty until Scan finds real lights.
export function VenueView(): JSX.Element {
  const s = useShell();
  const [modes, setModes] = useState<Record<string, TransportMode>>({});
  const scan = (): void => {
    void invoke("venue/scan", { version: 1 }).then((result: unknown) => {
      const envelope = result as { ok?: boolean; devices?: { address: string; name: string }[] } | null;
      const list = envelope && envelope.ok !== false && Array.isArray(envelope.devices) ? envelope.devices : [];
      s.set({ devices: list });
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
          {s.tiles.map((t) => {
            const row = withTransportMode(deviceScreenRow(t, t.firmware !== "unknown"), modes[t.id] ?? "hybrid");
            return (
              <div key={t.id} className="flex flex-col gap-2">
                <DeviceTile
                  tile={t}
                  onAction={(a) => {
                    if (a === "IDENTIFY") void invoke("venue/identify", { version: 1, id: t.id });
                    else if (a === "TEST CHASE") void invoke("venue/test-chase", { version: 1, id: t.id });
                    else void invoke("venue/device-action", { version: 1, id: t.id, action: "RECALIBRATE" });
                  }}
                />
                <label className="flex items-center gap-2 text-[13px]">Transport:
                  <Select value={row.transportMode} onValueChange={(v) => {
                    const mode = v as TransportMode;
                    setModes((prev) => ({ ...prev, [t.id]: mode }));
                    void invoke("config/set", { version: 1, scope: "device", key: "govee.device.<fixtureId>.transportMode", value: mode });
                  }}>
                    <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
                    <SelectContent>{(["hybrid", "lan", "ble"] as const).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                  </Select>
                </label>
                <p className="text-[13px] text-muted-foreground">
                  {row.segments === null ? "segments: unmeasured" : `${row.segments} segments`} · {row.latencySource === "measured" ? `${row.latencyMs}ms measured` : "latency: unmeasured"} · {row.firmware}
                </p>
              </div>
            );
          })}
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
