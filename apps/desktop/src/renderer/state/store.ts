import { create } from "zustand";
import type { LiveState } from "../App.js";
import type { DeviceTile } from "../venue.js";
import type { EnergyTier } from "../components.js";
import type { PartyPalette } from "../components.js";
import type { AltPattern, LightTarget } from "../components.js";

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

interface ShellState {
  route: Route;
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
  bpm: 128,
  devices: [],
  target: "Both",
  tiles: [],
  live: null,
  set: (patch) => set(patch),
}));
