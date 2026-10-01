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

export function switchVenue(venue: Venue): { venue: Venue; rerenderVersion: number } {
  return { venue, rerenderVersion: venue.version + 1 };
}

export function exportVenue(venue: Venue): VenueFile {
  return { format: "autolight-venue", version: 1, venue: structuredClone(venue) };
}

export function importVenue(file: VenueFile): Venue {
  if (file.format !== "autolight-venue" || file.version !== 1) {
    const seen = "version" in file && typeof file.version === "number" ? file.version : "missing";
    throw new Error(`unsupported venue file version ${String(seen)}`);
  }
  return structuredClone(file.venue);
}

export function setLogicalZero(venue: Venue, s: number): Venue {
  const zero = ((s % 1) + 1) % 1;
  return {
    ...venue,
    logicalZeroS: zero,
    room: { ...venue.room, logicalZeroS: zero },
    version: venue.version + 1,
  };
}

export interface VenueTemplate {
  id: string;
  name: string;
  describe: string;
}

export const VENUE_TEMPLATES: VenueTemplate[] = [
  { id: "square-loop", name: "Square room with ceiling loop", describe: "5 m square, closed ceiling loop, DJ mid-wall front" },
  { id: "club-rectangle", name: "Rectangular club", describe: "6 by 10 m, gap over the door, two lamps" },
  { id: "bedroom", name: "Bedroom", describe: "3 by 4 m, open path strip, one lamp" },
];

export function outlineRuns(room: Room, z: number): Run[] {
  const outline = normalizeOutline(room.outline);
  const pts = outline.map((p) => ({ x: p.x, y: p.y, z }));
  return [{ id: "ceiling-loop", polyline: pts, closed: true, mirroredOf: null }];
}

export function roomPerimeterM(room: Room): number {
  return perimeterLength(normalizeOutline(room.outline));
}
