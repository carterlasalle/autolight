import { useEffect } from "react";
import { Sidebar, Statusbar, Titlebar } from "../components/chrome.js";
import { CommandPalette } from "../components/command-palette.js";
import { Toaster } from "../components/ui/sonner.js";
import { Routes } from "../routes/index.js";
import { useShell, invoke } from "./store.js";
import { useLiveCursor } from "./resolve-live.js";
import { shortcutFor } from "./shortcuts.js";
// App shell (spec 83 src/app, spec 88-89): titlebar + sidebar + workspace +
// statusbar. Screens live in src/routes and src/features; the shell owns no
// timing and no I/O beyond the typed intents it forwards.
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
          <Routes route={route} live={live} />
        </main>
      </div>
      <Statusbar />
      <CommandPalette />
      <Toaster />
    </div>
  );
}
