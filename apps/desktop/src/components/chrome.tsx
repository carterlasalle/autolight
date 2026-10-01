import { useShell, invoke } from "../app/store.js";
import type { Route } from "../app/store.js";
import { Button } from "./ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card.js";
import { Badge } from "./ui/badge.js";
import { MetricBadge, StatusDot, deckBpm } from "./kit.js";

// Titlebar: hiddenInset traffic lights on macOS, overlay on Win/Linux
// (electron/main.ts). Drag region + no-drag controls per Electron docs.
export function Titlebar(): JSX.Element {
  const bpm = useShell((s) => s.bpm);
  const live = useShell((s) => s.live);
  const simulatorMode = useShell((s) => s.simulatorMode);
  const set = useShell((s) => s.set);
  return (
    <header className="app-drag-region sticky top-0 z-10 flex h-11 items-center gap-2 border-b bg-background/90 px-4 backdrop-blur-xl">
      <span className="w-16 shrink-0" aria-hidden />
      <span className="text-[13px] font-semibold tracking-tight">AutoLight</span>
      <Badge variant="secondary" className="app-no-drag">
        {live ? `${live.source.toLowerCase()} ●` : "no decks"}
      </Badge>
      {simulatorMode ? (
        <Badge variant="destructive" className="app-no-drag" title="Simulated providers and loopback Govee devices. Same pipeline, simulated sources and sinks.">
          SIMULATOR
        </Badge>
      ) : null}
      <MetricBadge metric={{ label: "BPM", value: deckBpm(bpm), unit: "" }} />
      <span className="flex-1" />
      <Button
        variant="ghost"
        size="sm"
        className="app-no-drag"
        title={simulatorMode ? "Leave Simulator mode" : "Enter Simulator mode"}
        onClick={() => {
          const next = !useShell.getState().simulatorMode;
          set({ simulatorMode: next });
          void invoke("simulator/mode", { version: 1, enabled: next });
        }}
      >
        {simulatorMode ? "Exit SIM" : "SIM"}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="app-no-drag"
        onClick={() => { void invoke("master/blackout", { version: 1 }); }}
      >
        Blackout
      </Button>
    </header>
  );
}

export function Statusbar(): JSX.Element {
  const bpm = useShell((s) => s.bpm);
  const live = useShell((s) => s.live);
  const devices = useShell((s) => s.devices);
  return (
    <footer className="flex h-8 items-center gap-3 border-t px-4 text-xs text-muted-foreground">
      <StatusDot tone={live ? "ok" : "neutral"} label={live ? live.source : "No DJ link"} />
      <span>{live ? "Show loaded" : "No show — load a track"}</span>
      <span>{devices.length > 0 ? `${devices.length} lights` : "No lights"}</span>
      <span className="flex-1" />
      <MetricBadge metric={{ label: "BPM", value: deckBpm(bpm), unit: "" }} />
    </footer>
  );
}

export function Sidebar({ route, onRoute }: {
  route: Route;
  onRoute: (r: Route) => void;
}): JSX.Element {
  const groups: { label: string; items: { id: Route; label: string }[] }[] = [
    { label: "Show", items: [{ id: "live", label: "Live" }, { id: "library", label: "Library" }, { id: "inspector", label: "Inspector" }] },
    { label: "Lighting", items: [{ id: "venue", label: "Venue" }, { id: "setup", label: "Setup" }] },
    { label: "System", items: [{ id: "diagnostics", label: "Diagnostics" }, { id: "settings", label: "Settings" }] },
  ];
  return (
    <nav aria-label="Routes" className="flex w-44 shrink-0 flex-col gap-4 border-r p-3">
      {groups.map((g) => (
        <div key={g.label} className="flex flex-col gap-0.5">
          <p className="px-2 text-[11px] font-semibold tracking-wider text-muted-foreground">{g.label}</p>
          {g.items.map((item) => (
            <Button
              key={item.id}
              variant={route === item.id ? "secondary" : "ghost"}
              size="sm"
              className="justify-start"
              onClick={() => onRoute(item.id)}
            >
              {item.label}
            </Button>
          ))}
        </div>
      ))}
    </nav>
  );
}

export function Panel({ title, children, className }: {
  title: string;
  children: React.ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-[13px]">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2.5">{children}</CardContent>
    </Card>
  );
}
