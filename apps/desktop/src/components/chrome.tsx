import { useShell, typedInvoke } from "../app/store.js";
import type { Route } from "../app/store.js";
import { Button } from "./ui/button.js";
import { Badge } from "./ui/badge.js";
import { MetricBadge, StatusDot, deckBpm } from "./kit.js";
import { tokens } from "../app/tokens.js";

// Baked at bundle time by vite.config.ts `define` (short HEAD + dirty flag +
// timestamp). Lets the running UI prove which commit it is.
declare const __AUTOLIGHT_BUILD__: { sha: string; dirty: boolean; builtAt: string } | undefined;

const BUILD_INFO: { sha: string; dirty: boolean; builtAt: string } =
  typeof __AUTOLIGHT_BUILD__ !== "undefined" ? __AUTOLIGHT_BUILD__ : { sha: "dev", dirty: true, builtAt: "unknown" };

// Titlebar: hiddenInset traffic lights on macOS, overlay on Win/Linux
// (electron/main.ts). Drag region + no-drag controls per Electron docs.

/** BPM badge shared by the titlebar and statusbar: one label/format source. */
function BpmMetric(): JSX.Element {
  const bpm = useShell((s) => s.bpm);

  return <MetricBadge metric={{ label: "BPM", value: deckBpm(bpm), unit: "" }} />;
}

export function Titlebar(): JSX.Element {
  const live = useShell((s) => s.live);
  const simulatorMode = useShell((s) => s.simulatorMode);
  const set = useShell((s) => s.set);

  return (
    <header className="app-drag-region sticky top-0 z-10 flex h-11 min-w-0 items-center gap-2 overflow-x-clip border-b bg-background/90 px-4 backdrop-blur-xl">
      <span className="hidden w-16 shrink-0 min-[900px]:block" aria-hidden />
      <span className="truncate text-sm font-semibold tracking-tight">AutoLight</span>
      <Badge variant="secondary" className="app-no-drag">
        {live ? `${live.source.toLowerCase()} ●` : "no decks"}
      </Badge>
      {simulatorMode ? (
        <Badge variant="destructive" className="app-no-drag" title="Simulated providers and loopback Govee devices. Same pipeline, simulated sources and sinks.">
          SIMULATOR
        </Badge>
      ) : null}
      <BpmMetric />
      <span className="flex-1" />
      <Button
        variant="ghost"
        size="sm"
        className="app-no-drag"
        title={simulatorMode ? "Leave Simulator mode" : "Enter Simulator mode"}
        onClick={() => {
          const next = !useShell.getState().simulatorMode;
          set({ simulatorMode: next });
          void typedInvoke("simulator/mode", { version: 1, enabled: next });
        }}
      >
        {simulatorMode ? "Exit SIM" : "SIM"}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="app-no-drag"
        onClick={() => { useShell.getState().set({ altOn: false }); void typedInvoke("master/blackout", { version: 1 }); }}
      >
        Blackout
      </Button>
    </header>
  );
}

export function Statusbar(): JSX.Element {
  const live = useShell((s) => s.live);
  const devices = useShell((s) => s.devices);

  return (
    <footer className="flex h-8 min-w-0 items-center gap-3 overflow-x-clip border-t px-4 text-xs text-muted-foreground">
      <StatusDot tone={live ? "ok" : "neutral"} label={live ? live.source : "No DJ link"} />
      <span className="truncate">{live ? "Show loaded" : "No show — load a track"}</span>
      <span className="shrink-0">{devices.length > 0 ? `${devices.length} lights` : "No lights"}</span>
      <span className="flex-1" />
      <span className="shrink-0 font-mono" title={`built ${BUILD_INFO.builtAt}${BUILD_INFO.dirty ? " (dirty tree)" : ""}`}>
        {BUILD_INFO.sha}{BUILD_INFO.dirty ? "*" : ""}
      </span>
      <BpmMetric />
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
          <p className={`px-2 font-semibold tracking-wider text-muted-foreground ${tokens.type.caption}`}>{g.label}</p>
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

