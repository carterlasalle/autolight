import { useEffect, useState } from "react";
import { invoke, useShell } from "../app/store.js";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "./ui/command.js";

// ⌘K palette: jump routes + fire emergency controls without touching the mouse.
// Emergency items call the same typed intents as the shortcut keys (T-UI-03):
// Blackout (B), Full white (W), Freeze (F), Resume auto (A). No modal, no
// close-only item: F-APP-17 was exactly these two items closing the palette.
export function CommandPalette(): JSX.Element {
  const [open, setOpen] = useState(false);
  const set = useShell((s) => s.set);
  useEffect(() => {
    const onPalette = (): void => { setOpen(true); };
    window.addEventListener("autolight:palette", onPalette);
    return () => { window.removeEventListener("autolight:palette", onPalette); };
  }, []);
  const go = (route: "live" | "library" | "inspector" | "venue" | "setup" | "diagnostics"): void => {
    set({ route });
    setOpen(false);
  };
  const fire = (channel: "master/blackout" | "master/full" | "master/freeze" | "master/resume"): void => {
    if (channel === "master/freeze") void invoke(channel, { version: 1, frozen: true });
    else if (channel === "master/resume") void invoke(channel, { version: 1, at: "bar" });
    else void invoke(channel, { version: 1 });
    setOpen(false);
  };
  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Go to, or trigger…" />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        <CommandGroup heading="Go">
          {(["live", "library", "inspector", "venue", "setup", "diagnostics"] as const).map((r) => (
            <CommandItem key={r} onSelect={() => { go(r); }}>Go to {r}</CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Emergency">
          <CommandItem onSelect={() => { fire("master/blackout"); }}>Blackout (B)</CommandItem>
          <CommandItem onSelect={() => { fire("master/full"); }}>Full white (W)</CommandItem>
          <CommandItem onSelect={() => { fire("master/freeze"); }}>Freeze (F)</CommandItem>
          <CommandItem onSelect={() => { fire("master/resume"); }}>Resume auto (A)</CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
