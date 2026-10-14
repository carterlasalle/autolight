import { useEffect, useState } from "react";
import { useShell, invoke } from "../../app/store.js";
import { Button } from "../../components/ui/button.js";
import { Input } from "../../components/ui/input.js";
import { Switch } from "../../components/ui/switch.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select.js";
import { deviceScreenRow, withTransportMode, type TransportMode } from "../../routes/venue/device-screens.js";
import { RoomVenueRoute } from "../../routes/venue/index.js";
import type { DeviceTile } from "./venue.js";
import type { Room } from "@autolight/venue";
import { rectangleRoom } from "@autolight/venue";

// Venue, redesigned: one scan section (find lights), one rig section (per
// light: see it, name it, prove it). Every prior control survives: tabs,
// scan/rescan, scan-targets, A/B/Both target, per-tile IDENTIFY/TEST
// CHASE/RECALIBRATE, per-tile transport select, room mapping. Saved lights
// hydrate from the registry on mount, so a restart shows the rig and its
// last-known status without a rescan.
//
// Owner Govee units on ND resnet (broadcast-isolated from the dev machine):
// H6076 goveelamp plus H1A45 carterlights, both LAN Control on, verified
// 2026-10-12 by unicast scan plus devStatus read-back.
const KNOWN_SCAN_TARGETS: readonly string[] = [
  "goveelamp.resnet.nd.edu",
  "carterlights.resnet.nd.edu",
];

// venue/scan and venue/list reply with these (show-service deviceRecord):
// measured fields stay null when unknown, never a placeholder string.
interface VenueDevice {
  id: string; address: string; name: string; sku: string; firmware: string;
  health: DeviceTile["health"]; enabled: boolean;
  zones: number | null; rttMs: number | null; rung: string; lastSeenMs: number;
}

function tileForDevice(d: VenueDevice): DeviceTile {
  return {
    id: d.id,
    sku: d.sku,
    name: d.name,
    enabled: d.enabled,
    ip: d.address !== "" ? d.address : null,
    firmware: d.firmware,
    segments: d.zones ?? 0,
    fps: 0, sentFrames: 0, supersededFrames: 0,
    latencyMs: d.rttMs ?? 0,
    health: d.health,
  };
}

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
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    void invoke("config/get", { version: 1, key: "govee.lan.discovery.scanList" }).then((raw: unknown) => {
      if (cancelled) return;
      const envelope = raw as { ok?: boolean; value?: unknown } | null;

      const saved = envelope && envelope.ok !== false && Array.isArray(envelope.value)
        ? (envelope.value as unknown[]).map((v) => String(v))
        : [];

      const seeded = saved.length > 0 ? saved : [...KNOWN_SCAN_TARGETS];
      setScanTargets(seeded.join(", "));

      if (saved.length === 0 && seeded.length > 0) {
        void invoke("config/set", { version: 1, scope: "app", key: "govee.lan.discovery.scanList", value: seeded });
      }
    });

    // Saved lights hydrate from the registry: name, enabled and last-known
    // health survive a restart; re-scanning refreshes them.
    void invoke("venue/list", { version: 1 }).then((raw: unknown) => {
      if (cancelled) return;
      const envelope = raw as { ok?: boolean; fixtures?: unknown } | null;
      const list = envelope && envelope.ok !== false && Array.isArray(envelope.fixtures)
        ? (envelope.fixtures as VenueDevice[])
        : [];

      if (list.length === 0) return;
      useShell.getState().set({
        devices: list.map((d) => ({ address: d.address, name: d.name })),
        tiles: list.map(tileForDevice),
      });
    });

    return () => { cancelled = true; };
  }, []);

  const saveScanTargets = (): void => {
    const list = scanTargets.split(",").map((t) => t.trim()).filter((t) => t.length > 0);
    void invoke("config/set", { version: 1, scope: "app", key: "govee.lan.discovery.scanList", value: list }).then(() => setScanSaved(true));
  };

  const applyDevices = (list: VenueDevice[]): void => {
    s.set({ devices: list.map((d) => ({ address: d.address, name: d.name })) });
    s.set({ tiles: list.map(tileForDevice) });
  };

  const scan = (): void => {
    setScanning(true);
    void invoke("venue/scan", { version: 1 }).then((result: unknown) => {
      const envelope = result as { ok?: boolean; devices?: unknown } | null;
      const list = envelope && envelope.ok !== false && Array.isArray(envelope.devices)
        ? (envelope.devices as VenueDevice[])
        : [];
      applyDevices(list);
      setScanning(false);
    });
  };

  const commitName = (tile: DeviceTile): void => {
    const draft = (nameDrafts[tile.id] ?? tile.name).trim();

    if (draft.length === 0 || draft === tile.name) return;
    void invoke("venue/device-rename", { version: 1, id: tile.id, name: draft }).then(() => {
      useShell.getState().set({
        tiles: useShell.getState().tiles.map((t) => (t.id === tile.id ? { ...t, name: draft } : t)),
      });
      setNameDrafts((prev) => ({ ...prev, [tile.id]: draft }));
    });
  };

  const setEnabled = (tile: DeviceTile, enabled: boolean): void => {
    // Optimistic flip, reconciled by the reply: a refused change snaps back.
    useShell.getState().set({
      tiles: useShell.getState().tiles.map((t) => (t.id === tile.id ? { ...t, enabled } : t)),
    });
    void invoke("venue/device-enabled", { version: 1, id: tile.id, enabled })
      .then((raw: unknown) => {
        const ok = (raw as { ok?: boolean } | null)?.ok !== false;

        if (!ok) throw new Error("refused");
      })
      .catch(() => {
        useShell.getState().set({
          tiles: useShell.getState().tiles.map((t) => (t.id === tile.id ? { ...t, enabled: !enabled } : t)),
        });
      });
  };

  const identified = useShell((st) => st.identifiedIds);
  const chased = useShell((st) => st.chasePassedIds);

  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <div role="tablist" aria-label="Venue sections" className="flex gap-2">
        {(["lights", "room"] as const).map((t) => (
          <Button key={t} size="sm" variant={tab === t ? "default" : "outline"} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {t === "lights" ? "Lights" : "Room mapping"}
          </Button>
        ))}
      </div>
      {tab === "room" ? <RoomVenueRoute room={room} onRoom={setRoom} saved={roomSaved} onSaved={recordRoomSaved} /> : (<>
      <section aria-label="Find lights" className="rounded-xl border border-border bg-card px-4 py-3 text-sm">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h2 className="text-base font-medium">
            Find lights{s.devices.length > 0 ? <span className="text-muted-foreground"> · {s.devices.length} on the rig</span> : null}
          </h2>
          <span className="flex-1" />
          <div className="flex items-center gap-1" role="radiogroup" aria-label="Control target">
            {(["A", "B", "Both"] as const).map((t) => (
              <Button key={t} size="sm" variant={s.target === t ? "default" : "ghost"} onClick={() => { s.set({ target: t }); }} aria-pressed={s.target === t}>
                {t}
              </Button>
            ))}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={scan} disabled={scanning}>
            {scanning ? "Scanning…" : s.devices.length === 0 ? "Scan the LAN" : "Rescan"}
          </Button>
          <label className="flex min-w-0 flex-1 basis-64 items-center gap-2">
            <span className="shrink-0 text-xs text-muted-foreground">Targets</span>
            <Input aria-label="Scan targets (IPs or hostnames)" value={scanTargets} onChange={(e) => { setScanTargets(e.target.value); setScanSaved(false); }} placeholder="10.24.253.138, carterlights.resnet.nd.edu" className="h-8 min-w-0" />
          </label>
          <Button size="sm" variant="ghost" onClick={saveScanTargets}>Save</Button>
          {scanSaved ? <span className="text-xs text-muted-foreground">Saved.</span> : null}
        </div>
        {s.devices.length === 0 && !scanning ? (
          <p className="mt-2 text-xs text-muted-foreground">Power the lights in LAN mode, then scan. Campus networks need targets above; home networks usually answer the broadcast.</p>
        ) : null}
      </section>
      {s.tiles.length > 0 ? (
        <section aria-label="Rig" className="flex flex-col gap-3">
          {s.tiles.map((t) => {
            const qualified = t.firmware !== "" && t.firmware !== "unknown";
            const row = withTransportMode(deviceScreenRow(t, qualified), modes[t.id] ?? "hybrid");
            const isIdentified = identified.includes(t.id);
            const isChased = chased.includes(t.id);
            const healthTone = t.health === "online" ? "bg-emerald-500" : t.health === "degraded" ? "bg-amber-500" : "bg-red-500";
            const firmwareText = qualified ? t.firmware : "firmware ?";

            return (
              <article key={t.id} aria-label={`${t.sku} ${t.ip ?? t.id}`} className={`min-w-0 rounded-xl border border-border bg-card px-4 py-3${t.enabled ? "" : " opacity-60"}`}>
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                  <span className={`inline-block h-2 w-2 shrink-0 self-center rounded-full ${healthTone}`} aria-hidden />
                  <Input
                    aria-label={`Name for ${t.sku}`}
                    value={nameDrafts[t.id] ?? t.name}
                    onChange={(e) => setNameDrafts((prev) => ({ ...prev, [t.id]: e.target.value }))}
                    onBlur={() => commitName(t)}
                    onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                    className="h-8 w-48 min-w-0 font-medium"
                  />
                  <span className="font-mono text-xs text-muted-foreground">{t.sku} · {t.ip ?? t.id}</span>
                  <span className="flex-1" />
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {t.segments > 0 ? `${t.segments} seg` : "segments ?"} · {t.latencyMs > 0 ? `${t.latencyMs}ms` : "rtt ?"} · {firmwareText} · {t.health}
                  </span>
                </div>
                <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant={isIdentified ? "secondary" : "default"}
                    onClick={() => {
                      void invoke("venue/identify", { version: 1, id: t.id }).then((result: unknown) => {
                        const ok = (result as { ok?: boolean } | null)?.ok !== false;

                        if (ok && !useShell.getState().identifiedIds.includes(t.id)) {
                          useShell.getState().set({ identifiedIds: [...useShell.getState().identifiedIds, t.id] });
                        }
                      });
                    }}
                  >
                    {isIdentified ? "✓ Identified" : "Identify"}
                  </Button>
                  <Button
                    size="sm"
                    variant={isChased ? "secondary" : "outline"}
                    onClick={() => {
                      void invoke("venue/test-chase", { version: 1, id: t.id }).then((result: unknown) => {
                        const ok = (result as { ok?: boolean } | null)?.ok !== false;

                        if (ok && !useShell.getState().chasePassedIds.includes(t.id)) {
                          useShell.getState().set({ chasePassedIds: [...useShell.getState().chasePassedIds, t.id] });
                        }
                      });
                    }}
                  >
                    {isChased ? "✓ Chase passed" : "Test chase"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { void invoke("venue/device-action", { version: 1, id: t.id, action: "RECALIBRATE" }); }}>
                    Recalibrate
                  </Button>
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Switch checked={t.enabled} onCheckedChange={(v) => setEnabled(t, v)} aria-label={`Include ${t.sku} on the rig`} />
                    On rig
                  </label>
                  <span className="flex-1" />
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    Transport
                    <Select value={row.transportMode} onValueChange={(v) => {
                      const mode = v as TransportMode;
                      setModes((prev) => ({ ...prev, [t.id]: mode }));
                      void invoke("config/set", { version: 1, scope: "device", key: "govee.device.<fixtureId>.transportMode", value: mode });
                    }}>
                      <SelectTrigger className="h-8 w-24 font-mono text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>{(["hybrid", "lan", "ble"] as const).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                    </Select>
                  </label>
                </div>
              </article>
            );
          })}
        </section>
      ) : (
        <section aria-label="Rig" className="rounded-xl border border-dashed border-border px-4 py-6 text-center">
          <p className="text-sm text-muted-foreground">No fixtures on the rig yet. Scan above, then identify each light so the room knows what flashed.</p>
        </section>
      )}
      </>)}
    </div>
  );
}
