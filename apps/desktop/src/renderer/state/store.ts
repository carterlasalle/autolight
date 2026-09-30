import { create } from "zustand";
import type { ShowCue } from "@autolight/contracts";
import type { DeviceTile } from "../venue.js";

// LiveState: resolved show for the decks actually loaded right now.
// null = nothing resolved yet — UI shows empty states, never mock tracks.
export interface LiveState {
  source: "REKORDBOX" | "SERATO";
  bpm: number | null;
  beat: number | undefined;
  deckA: { title: string; section: string | undefined; countdown: string | undefined };
  deckB: { title: string; section: string | undefined; countdown: string | undefined };
  cues: ShowCue[];
  cells: { x: number; color: string }[];
}


declare global {
  interface Window {
    autolight?: { invoke: (channel: string, payload: unknown) => Promise<unknown> };
  }
}

export function invoke(channel: string, payload: unknown): Promise<unknown> {
  return (
    window.autolight?.invoke(channel, payload).catch(() => undefined) ?? Promise.resolve(undefined)
  );
}

type Route = "live" | "library" | "inspector" | "venue" | "setup" | "diagnostics";

export type EnergyTier = "LOW" | "MED" | "HIGH";
export const PARTY_PALETTES = ["ND", "Warm", "Cool", "Neon", "Fire", "Ocean", "UV"] as const;
export type PartyPalette = (typeof PARTY_PALETTES)[number];
export const ALT_PATTERNS = [
  "Alternating Flash",
  "Alternating On/Off",
  "Alternating Colors",
  "Chase (A→B→A→B)",
  "Opposite Colors",
] as const;
export type AltPattern = (typeof ALT_PATTERNS)[number];
export type LightTarget = "A" | "B" | "Both";

// Follow mode: preview = designer tool (resolved grid + plan, no playhead
// chase). ax-beat = coarse AX poll (1Hz, ±1 beat). prolink = Virtual-CDJ
// beat/status capture (beat-accurate, needs link peer). soundswitch =
// Lighting IPC when that capture lands. No board required in any mode.
export type FollowMode = "preview" | "ax-beat" | "prolink" | "soundswitch";

interface ShellState {
  route: Route;
  followMode: FollowMode;
  style: string;
  palette: PartyPalette;
  blinder: boolean;
  running: boolean;
  manual: boolean;
  tier: EnergyTier | null;
  sensitivity: number;
  flashOn: boolean;
  flashMode: "static" | "cycle";
  wheelOn: boolean;
  wheelColor: [number, number, number];
  altOn: boolean;
  altPattern: AltPattern;
  altSpeed: number;
  bpm: number | null;
  devices: { address: string; name: string }[];
  target: LightTarget;
  tiles: DeviceTile[];
  live: LiveState | null;
  set: (patch: Partial<ShellState>) => void;
}

export const useShell = create<ShellState>((set) => ({
  route: "live",
  followMode: "preview",
  style: "House",
  palette: "ND",
  blinder: true,
  running: true,
  manual: false,
  tier: null,
  sensitivity: 1,
  flashOn: true,
  flashMode: "static",
  wheelOn: false,
  wheelColor: [255, 255, 255],
  altOn: false,
  altPattern: "Alternating Flash",
  altSpeed: 500,
  bpm: null,
  devices: [],
  target: "Both",
  tiles: [],
  live: null,
  set: (patch) => set(patch),
}));
