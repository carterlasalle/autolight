import { useEffect, useState } from "react";
import { useShell } from "../app/store.js";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "./ui/command.js";

// ⌘K palette: jump routes + fire emergency controls without touching the mouse.
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
          <CommandItem onSelect={() => { setOpen(false); }}>Blackout (B)</CommandItem>
          <CommandItem onSelect={() => { setOpen(false); }}>Freeze (Z)</CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
