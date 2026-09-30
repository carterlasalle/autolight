import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { Sidebar, Statusbar, Titlebar } from "./components/chrome.js";
import { ControlGrid, LiveView } from "./components/live.js";
import { LibraryView } from "./components/library-view.js";
import { InspectorView } from "./components/inspector-view.js";
import { VenueView } from "./components/venue-view.js";
import { SetupView } from "./components/setup-view.js";
import { DiagnosticsView } from "./components/diagnostics-view.js";
import { SettingsView } from "./components/settings-view.js";
import { CommandPalette } from "./components/command-palette.js";
import { Toaster } from "./components/ui/sonner.js";
import { useShell, invoke } from "./state/store.js";
import { useLiveCursor } from "./state/resolve-live.js";
import { shortcutFor } from "./shortcuts.js";
// App shell: titlebar + sidebar + workspace + statusbar (§88-89).
// Live owns the performance surface; the rest are tabs in the same window.
export function Shell(): JSX.Element {
  const route = useShell((s) => s.route);
  const set = useShell((s) => s.set);
  const live = useShell((s) => s.live);

  useLiveCursor();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const el = event.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent("autolight:palette"));
        return;
      }
      const ch = shortcutFor(event.key);
      if (ch) void invoke(ch, ch === "master/freeze" ? { version: 1, frozen: true } : { version: 1 });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener("keydown", onKeyDown); };
  }, []);

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <Titlebar />
      <div className="flex min-h-0 flex-1">
        <Sidebar route={route} onRoute={(r) => { set({ route: r }); }} />
        <main className="min-w-0 flex-1 overflow-y-auto p-4">
          {route === "live" && (
            <div className="flex max-w-6xl flex-col gap-3">
              <LiveView live={live} />
              <ControlGrid />
            </div>
          )}
          {route === "library" && <LibraryView />}
          {route === "inspector" && <InspectorView />}
          {route === "venue" && <VenueView />}
          {route === "setup" && <SetupView />}
          {route === "diagnostics" && <DiagnosticsView />}
          {route === "settings" && <SettingsView />}
        </main>
      </div>
      <Statusbar />
      <CommandPalette />
      <Toaster />
    </div>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
createRoot(root).render(<Shell />);
