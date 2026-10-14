import { typedInvoke, useShell } from "../../app/store.js";
import type { DeviceTile } from "./venue.js";

// Live rig hydration: the venue registry is the source of the rig (name,
// enabled, firmware, health, zones), and every screen that shows lights
// reads the same store slice. Hydrating at the app shell means the Live
// console has targets and segment counts without a Venue visit first.

// venue/scan and venue/list reply with these (show-service deviceRecord):
// measured fields stay null when unknown, never a placeholder string.
export interface VenueDevice {
  id: string; address: string; name: string; sku: string; firmware: string;
  health: DeviceTile["health"]; enabled: boolean;
  zones: number | null; rttMs: number | null; rung: string; lastSeenMs: number;
}

function tileForDevice(d: VenueDevice): DeviceTile {
  return {
    id: d.id,
    sku: d.sku,
    name: d.name,
    enabled: d.enabled,
    ip: d.address !== "" ? d.address : null,
    firmware: d.firmware,
    segments: d.zones ?? 0,
    fps: 0, sentFrames: 0, supersededFrames: 0,
    latencyMs: d.rttMs ?? 0,
    health: d.health,
  };
}

export function applyRigDevices(list: VenueDevice[]): void {
  useShell.getState().set({
    devices: list.map((d) => ({ address: d.address, name: d.name })),
    tiles: list.map(tileForDevice),
  });
}

/** Hydrate the rig from the registry (venue/list → store). A no-op while
 *  the registry is empty; never blanks the rig on a failed read. */
export function hydrateRig(): void {
  void typedInvoke("venue/list", { version: 1 }).then((res) => {
    // SAFETY: venue/list's reply contract carries a fixtures array; each row
    // is the DeviceRecord shape the venue screens render (defensive cast).
    const list = res !== null && Array.isArray(res.fixtures) ? (res.fixtures as VenueDevice[]) : [];

    if (list.length === 0) return;
    applyRigDevices(list);
  });
}
