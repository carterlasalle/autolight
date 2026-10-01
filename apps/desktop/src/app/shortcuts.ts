// Keyboard shortcuts for emergency controls (spec 94, T-UI-03): BLACKOUT and
// friends need no modal and work from every screen. Every value names a real
// typed IPC channel (T-TRU-03 matrix covers each one); intents without a
// channel yet (manual lane, intensity steps, presets, Space) stay out of the
// map until their channel exists, so no key silently does nothing.
// Text inputs keep focus (the shell skips INPUT and TEXTAREA targets).
export const SHORTCUTS: Record<string, string> = {
  b: "master/blackout",
  w: "master/full",
  f: "master/freeze",
  a: "master/resume",
};

export function shortcutFor(key: string): string | null {
  return SHORTCUTS[key.toLowerCase()] ?? null;
}

// No-modal guarantee (§144): Live mode surfaces issues as status, never dialogs.
export function isModalAllowed(liveActive: boolean): boolean {
  return !liveActive;
}
