import { describe, expect, it } from "vitest";
import { rectangleRoom } from "./room.js";
import { emptyVenue, exportVenue, importVenue, setLogicalZero } from "./venue.js";

describe("T-ROOM-11 venue persistence, import and export", () => {
  it("round-trips a venue through export and import", () => {
    const venue = emptyVenue(rectangleRoom(5, 5));
    const back = importVenue(exportVenue(venue));
    expect(back).toEqual(venue);
  });

  it("rejects foreign venue files with a typed error", () => {
    expect(() => importVenue({ format: "other", version: 9, venue: emptyVenue(rectangleRoom(5, 5)) } as never)).toThrow(
      /unsupported venue file/,
    );
  });

  it("persists logical zero moves across the round trip", () => {
    const venue = setLogicalZero(emptyVenue(rectangleRoom(5, 5)), 0.3);
    expect(importVenue(exportVenue(venue)).logicalZeroS).toBeCloseTo(0.3, 9);
    expect(importVenue(exportVenue(venue)).room.logicalZeroS).toBeCloseTo(0.3, 9);
  });
});
