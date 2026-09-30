import { useShell, invoke } from "../state/store.js";
import { Button } from "./ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card.js";
import { Badge } from "./ui/badge.js";

// Titlebar: hiddenInset traffic lights on macOS, overlay on Win/Linux
// (electron/main.ts). Drag region + no-drag controls per Electron docs.
export function Titlebar(): JSX.Element {
  const running = useShell((s) => s.running);
  const bpm = useShell((s) => s.bpm);
  return (
    <header className="app-drag-region sticky top-0 z-10 flex h-11 items-center gap-2 border-b bg-background/90 px-4 backdrop-blur-xl">
      <span className="w-16 shrink-0" aria-hidden />
      <span className="text-[13px] font-semibold tracking-tight">AutoLight</span>
      <Badge variant={running ? "default" : "secondary"} className="app-no-drag">
        {running ? "rekordbox ●" : "held"}
      </Badge>
      <span className="font-timing text-xs text-muted-foreground tabular-nums">
        {(bpm ?? 128).toFixed(1)} BPM
      </span>
      <span className="flex-1" />
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
  const tiles = useShell((s) => s.tiles);
  return (
    <footer className="flex h-8 items-center gap-3 border-t px-4 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className="inline-block size-1.5 rounded-full bg-[var(--ok)]" aria-hidden /> Rekordbox
      </span>
      <span>Analysis ready</span>
      <span>{tiles.length > 0 ? `${tiles.length} lights` : "4 lights"}</span>
      <span className="flex-1" />
      <span className="font-timing tabular-nums">{(bpm ?? 128).toFixed(1)} BPM · 5.8 ms</span>
    </footer>
  );
}

export function Sidebar({ route, onRoute }: {
  route: string;
  onRoute: (r: "live" | "library" | "inspector" | "venue" | "setup" | "diagnostics") => void;
}): JSX.Element {
  const groups: { label: string; items: { id: typeof route; label: string }[] }[] = [
    { label: "Show", items: [{ id: "live", label: "Live" }, { id: "library", label: "Library" }, { id: "inspector", label: "Inspector" }] },
    { label: "Lighting", items: [{ id: "venue", label: "Venue" }, { id: "setup", label: "Setup" }] },
    { label: "System", items: [{ id: "diagnostics", label: "Diagnostics" }] },
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
              onClick={() => onRoute(item.id as "live")}
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
