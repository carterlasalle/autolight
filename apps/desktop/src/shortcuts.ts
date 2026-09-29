// Keyboard shortcuts for emergency controls (§94): BLACKOUT needs no modal.
// Space toggles play-pause intent; B blackout, F full, Z freeze, 1-9 intensity.
export const SHORTCUTS: Record<string, string> = {
  b: "master/blackout",
  f: "master/full",
  z: "master/freeze",
  a: "master/resume",
};

export function shortcutFor(key: string): string | null {
  return SHORTCUTS[key.toLowerCase()] ?? null;
}

// No-modal guarantee (§144): Live mode surfaces issues as status, never dialogs.
export function isModalAllowed(liveActive: boolean): boolean {
  return !liveActive;
}
