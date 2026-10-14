import { create } from "zustand";
import { callChannel, partyPaletteNames, type Channel, type ChannelRequest, type ChannelResponse, type PartyPaletteName } from "@autolight/ipc";
import type { ShowCue } from "@autolight/contracts";
import type { DeviceTile } from "../features/venue/venue.js";

// LiveState: resolved show for the decks actually loaded right now.
// null = nothing resolved yet — UI shows empty states, never fixture tracks.
export interface DeckSnapshot { title: string; artist: string; readiness: "READY" | "NEEDS ANALYSIS"; bpm: number | null; section: string | undefined; countdown: string | undefined }

export interface LiveState {
  source: "REKORDBOX" | "SERATO";
  bpm: number | null;
  beat: number | undefined;
  deckA: DeckSnapshot;
  deckB: DeckSnapshot;
  cues: ShowCue[];
  cells: { x: number; color: string }[];
  // Track palette (section kinds) for the manual lane swatches; empty when
  // the resolved decks carry no palette, and the lane falls back to basics.
  palette: [number, number, number][];
}


declare global {
  interface Window {
    autolight?: { invoke: (channel: string, payload: unknown) => Promise<unknown> };
  }
}

// T-ARC-02: IPC errors surface in diagnostics status, never swallowed into
// undefined. Callers that tolerate absence check for null explicitly.
function recordIpcFailure(key: string, message: string): void {
  const { diagnostics, set } = useShell.getState();

  set({ diagnostics: { ...diagnostics, [key]: message } });
}

function clearIpcFailure(key: string): void {
  const { diagnostics, set } = useShell.getState();

  if (!(key in diagnostics)) return;
  const next = { ...diagnostics };

  delete next[key];
  set({ diagnostics: next });
}

export async function invoke(channel: string, payload: unknown): Promise<unknown> {
  const key = `ipc:${channel}`;

  try {
    if (!window.autolight) {
      recordIpcFailure(key, "unavailable: preload missing");

      return null;
    }

    const result = await window.autolight.invoke(channel, payload);

    clearIpcFailure(key);

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    recordIpcFailure(key, message);

    return null;
  }
}

// Typed client (T-ARC-02 ratchet): new renderer call sites go through
// callChannel, so request and response validate against the channel table
// and the channel name is checked at compile time. Failures record exactly
// like invoke(); null means "did not land", never undefined.
export async function typedInvoke<C extends Channel>(channel: C, request: ChannelRequest<C>): Promise<Extract<ChannelResponse<C>, { ok: true }> | null> {
  const key = `ipc:${channel}`;

  try {
    const api = window.autolight;

    if (!api) {
      recordIpcFailure(key, "unavailable: preload missing");

      return null;
    }

    const result = await callChannel(api.invoke, channel, request);

    clearIpcFailure(key);

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    recordIpcFailure(key, message);

    return null;
  }
}

export type Route = "live" | "library" | "inspector" | "venue" | "setup" | "diagnostics" | "settings";

type EnergyTier = "LOW" | "MED" | "HIGH";

// One source: the channel schema in @autolight/ipc owns the palette names;
// the main process owns their colour values.
export const PARTY_PALETTES = partyPaletteNames;

export type PartyPalette = PartyPaletteName;

type LightTarget = "A" | "B" | "Both";

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
  blackout: boolean;
  frozen: boolean;
  sensitivity: number;
  flashOn: boolean;
  flashMode: "static" | "cycle";
  wheelOn: boolean;
  wheelColor: [number, number, number];
  pendingStyle: string | null;
  liveBeat: number;
  altOn: boolean;
  altSpeed: number;
  // Party-card tempo for the beat effects: tap tempo here, or the mic
  // estimate written by the operator-started Audio sync card. Separate from
  // `bpm`, which mirrors the DJ deck.
  altBpm: number;
  bpm: number | null;
  reactiveLevel: number;
  overridesIntensity: number | null;
  audioDevices: { index: number; name: string }[];
  audioDevice: number | null;
  audioLevel: number;
  audioPermission: "unknown" | "granted" | "denied";
  paletteHue: number;
  devices: { address: string; name: string }[];
  target: LightTarget;
  tiles: DeviceTile[];
  identifiedIds: string[];
  chasePassedIds: string[];
  roomSaved: boolean;
  live: LiveState | null;
  selectedTrackId: string | null;
  diagnostics: Record<string, string>;
  simulatorMode: boolean;
  set: (patch: Partial<ShellState>) => void;
}

export const useShell = create<ShellState>((set) => ({
  route: "live",
  followMode: "preview",
  style: "house",
  palette: "ND",
  // Live lane starts quiet: autoloops, blinder and flash are opt-in moves,
  // not something a fresh launch asserts at the venue.
  blinder: false,
  running: false,
  manual: false,
  blackout: false,
  frozen: false,
  tier: null,
  sensitivity: 1,
  flashOn: false,
  flashMode: "static",
  wheelOn: false,
  wheelColor: [255, 255, 255],
  pendingStyle: null,
  liveBeat: 0,
  altOn: false,
  altSpeed: 500,
  altBpm: 128,
  bpm: null,
  reactiveLevel: 0,
  overridesIntensity: null,
  audioDevices: [],
  audioDevice: null,
  audioLevel: 0,
  audioPermission: "unknown",
  paletteHue: 0,
  devices: [],
  target: "Both",
  tiles: [],
  identifiedIds: [],
  chasePassedIds: [],
  roomSaved: false,
  live: null,
  selectedTrackId: null,
  diagnostics: {},
  simulatorMode: false,
  set: (patch) => set(patch),
}));
