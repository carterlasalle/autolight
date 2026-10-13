import { useEffect } from "react";
import { Sidebar, Statusbar, Titlebar } from "../components/chrome.js";
import { CommandPalette } from "../components/command-palette.js";
import { Toaster } from "../components/ui/sonner.js";
import { Routes } from "../routes/index.js";
import { useShell, invoke } from "./store.js";
import type { FollowMode } from "./store.js";
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

  // Follow mode persists in config (live.follow.mode) but the store resets
  // on reload/HMR. Re-assert the saved value every time Setup becomes
  // visible: mount effects alone miss the return trip.
  useEffect(() => {
    if (route !== "setup") return;
    let cancelled = false;
    const seen = useShell.getState().followMode;
    void invoke("config/get", { version: 1, key: "live.follow.mode" }).then((raw: unknown) => {
      if (cancelled) return;
      const envelope = raw as { ok?: boolean; value?: unknown } | null;
      const saved = envelope && envelope.ok !== false && typeof envelope.value === "string" ? envelope.value : null;
      const modes: FollowMode[] = ["preview", "ax-beat", "prolink", "soundswitch"];

      if (saved !== null && (modes as string[]).includes(saved)) {
        const mode = saved as FollowMode;

        if (useShell.getState().followMode === seen && seen !== mode) useShell.getState().set({ followMode: mode });
      }
    });

    return () => { cancelled = true; };
  }, [route]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const el = event.target as HTMLElement | null;

      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent("autolight:palette"));

        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const ch = shortcutFor(event.key);

      if (ch === "master/freeze") void invoke(ch, { version: 1, frozen: true });
      else if (ch === "master/resume") void invoke(ch, { version: 1, at: "bar" });
      else if (ch) void invoke(ch, { version: 1 });
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
