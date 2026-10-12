import { useEffect, useState } from "react";
import { useShell, invoke } from "../../app/store.js";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card.js";
import { Button } from "../../components/ui/button.js";
import { Input } from "../../components/ui/input.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select.js";
import { DeviceTile } from "../../components/kit.js";
import { deviceScreenRow, withTransportMode, type TransportMode } from "../../routes/venue/device-screens.js";
import { RoomVenueRoute } from "../../routes/venue/index.js";
import type { Room } from "@autolight/venue";
import { rectangleRoom } from "@autolight/venue";

// Venue (spec 98 ops live in the WP05 room editor under routes/venue/) +
// Device screen (spec 99): tiles with measured-or-unmeasured fields plus the
// transport mode dropdown. Empty until Scan finds real lights.
export function VenueView(): JSX.Element {
  const s = useShell();
  const [tab, setTab] = useState<"lights" | "room">("lights");
  const [room, setRoom] = useState<Room>(() => rectangleRoom(5, 5));
  const [roomSaved, setRoomSaved] = useState(false);
  const recordRoomSaved = (saved: boolean): void => {
    setRoomSaved(saved);
    if (saved) useShell.getState().set({ roomSaved: true });
  };
  const [modes, setModes] = useState<Record<string, TransportMode>>({});
  const [scanning, setScanning] = useState(false);
  const [scanTargets, setScanTargets] = useState("");
  const [scanSaved, setScanSaved] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void invoke("config/get", { version: 1, key: "govee.lan.discovery.scanList" }).then((raw: unknown) => {
      if (cancelled) return;
      const envelope = raw as { ok?: boolean; value?: unknown } | null;
      if (envelope && envelope.ok !== false && Array.isArray(envelope.value)) {
        setScanTargets((envelope.value as unknown[]).map((v) => String(v)).join(", "));
      }
    });
    return () => { cancelled = true; };
  }, []);
  const saveScanTargets = (): void => {
    const list = scanTargets.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
    void invoke("config/set", { version: 1, scope: "app", key: "govee.lan.discovery.scanList", value: list }).then(() => setScanSaved(true));
  };
  const scan = (): void => {
    setScanning(true);
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
          segments: 0,
          fps: 0,
          sentFrames: 0,
          supersededFrames: 0,
          latencyMs: 0,
          health: "online",
        })),
      });
      setScanning(false);
    });
  };
  return (
    <div className="flex max-w-5xl flex-col gap-3">
      <div role="tablist" aria-label="Venue sections" className="flex gap-2">
        {(["lights", "room"] as const).map((t) => (
          <Button key={t} size="sm" variant={tab === t ? "default" : "outline"} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {t === "lights" ? "Lights" : "Room mapping"}
          </Button>
        ))}
      </div>
      {tab === "room" ? <RoomVenueRoute room={room} onRoom={setRoom} saved={roomSaved} onSaved={recordRoomSaved} /> : (<>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Lights{s.devices.length > 0 ? ` · ${s.devices.length} found` : ""}</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={scan} disabled={scanning}>
              {scanning ? "Scanning…" : s.devices.length === 0 ? "Scan the LAN" : "Rescan"}
            </Button>
            {s.devices.length === 0 && !scanning ? (
              <span className="text-sm text-muted-foreground">No lights found yet — power them in LAN mode on this network, then scan.</span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex flex-1 items-center gap-2 text-sm">
              <span className="shrink-0 text-muted-foreground">Scan targets:</span>
              <Input aria-label="Scan targets (IPs or hostnames)" value={scanTargets} onChange={(e) => { setScanTargets(e.target.value); setScanSaved(false); }} placeholder="10.24.253.138, carterlights.resnet.nd.edu" className="h-8" />
            </label>
            <Button size="sm" variant="outline" onClick={saveScanTargets}>Save targets</Button>
            {scanSaved ? <span className="text-sm text-muted-foreground">Saved — next scan tries these directly.</span> : null}
          </div>
          <div className="flex items-center gap-2" role="radiogroup" aria-label="Control target">
            <span className="text-sm text-muted-foreground">Target:</span>
            {(["A", "B", "Both"] as const).map((t) => (
              <Button key={t} size="sm" variant={s.target === t ? "default" : "outline"} onClick={() => { s.set({ target: t }); }} aria-pressed={s.target === t}>
                {t}
              </Button>
            ))}
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
                    if (a === "IDENTIFY") {
                      void invoke("venue/identify", { version: 1, id: t.id }).then((result: unknown) => {
                        const ok = (result as { ok?: boolean } | null)?.ok !== false;
                        if (ok && !useShell.getState().identifiedIds.includes(t.id)) {
                          useShell.getState().set({ identifiedIds: [...useShell.getState().identifiedIds, t.id] });
                        }
                      });
                    } else if (a === "TEST CHASE") {
                      void invoke("venue/test-chase", { version: 1, id: t.id }).then((result: unknown) => {
                        const ok = (result as { ok?: boolean } | null)?.ok !== false;
                        if (ok && !useShell.getState().chasePassedIds.includes(t.id)) {
                          useShell.getState().set({ chasePassedIds: [...useShell.getState().chasePassedIds, t.id] });
                        }
                      });
                    } else void invoke("venue/device-action", { version: 1, id: t.id, action: "RECALIBRATE" });
                  }}
                />
                <label className="flex items-center gap-2 text-sm">Transport:
                  <Select value={row.transportMode} onValueChange={(v) => {
                    const mode = v as TransportMode;
                    setModes((prev) => ({ ...prev, [t.id]: mode }));
                    void invoke("config/set", { version: 1, scope: "device", key: "govee.device.<fixtureId>.transportMode", value: mode });
                  }}>
                    <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
                    <SelectContent>{(["hybrid", "lan", "ble"] as const).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                  </Select>
                </label>
                <p className="text-sm text-muted-foreground">
                  {row.segments === null ? "segments: unmeasured" : `${row.segments} segments`} · {row.latencySource === "measured" ? `${row.latencyMs}ms measured` : "latency: unmeasured"} · {row.firmware}
                </p>
              </div>
            );
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">No fixtures qualified yet. Scan, then run IDENTIFY + TEST CHASE per light.</p>
          </CardContent>
        </Card>
      )}
      </>)}
    </div>
  );
}
