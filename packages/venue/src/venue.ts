import type { Run, VenueFixture } from "./placement.js";
import type { Room } from "./room.js";
import { normalizeOutline, perimeterLength } from "./room.js";

export interface Venue {
  id: string;
  name: string;
  room: Room;
  fixtures: VenueFixture[];
  logicalZeroS: number;
  version: number;
}

export interface VenueFile {
  format: "autolight-venue";
  version: 1;
  venue: Venue;
}

export function emptyVenue(room: Room): Venue {
  return { id: `venue-${room.id}`, name: room.name, room, fixtures: [], logicalZeroS: room.logicalZeroS ?? 0, version: 1 };
}

// Result of a venue switch: the bumped venue and the rerender counter derived
// from the same version, so persistence and rerender stay consistent.
export interface VenueSwitch {
  venue: Venue;
  rerenderVersion: number;
}

export function switchVenue(venue: Venue): VenueSwitch {
  const version = venue.version + 1;

  return { venue: { ...venue, version }, rerenderVersion: version };
}

export function exportVenue(venue: Venue): VenueFile {
  return { format: "autolight-venue", version: 1, venue: structuredClone(venue) };
}

// Null-safe: `file` is an untrusted parsed payload, so a null, undefined or
// primitive input must produce the descriptive error instead of a TypeError.
// `file?.` and property reads never throw on primitives (only `in`/direct
// member access on null would), so the guard is safe for every JSON value.
export function importVenue(file: VenueFile | null | undefined): Venue {
  if (file?.format !== "autolight-venue" || file.version !== 1) {
    throw new Error(`unsupported venue file version ${String(file?.version ?? "missing")}`);
  }

  if (file.venue == null || file.venue.room == null) {
    throw new Error("venue file payload is missing or malformed");
  }

  return structuredClone(file.venue);
}

export function setLogicalZero(venue: Venue, s: number): Venue {
  if (!Number.isFinite(s)) throw new Error(`logical zero must be a finite number, got ${String(s)}`);
  const zero = ((s % 1) + 1) % 1;

  return {
    ...venue,
    logicalZeroS: zero,
    room: { ...venue.room, logicalZeroS: zero },
    version: venue.version + 1,
  };
}

export function outlineRuns(room: Room, z: number): Run[] {
  const outline = normalizeOutline(room.outline);
  const pts = outline.map((p) => ({ x: p.x, y: p.y, z }));

  return [{ id: "ceiling-loop", polyline: pts, closed: true, mirroredOf: null }];
}

export function roomPerimeterM(room: Room): number {
  return perimeterLength(normalizeOutline(room.outline));
}
