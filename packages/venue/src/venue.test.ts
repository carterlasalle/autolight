import { describe, expect, it } from "vitest";
import { rectangleRoom } from "./room.js";
import { emptyVenue, exportVenue, importVenue, setLogicalZero } from "./venue.js";

describe("T-ROOM-11 venue persistence, import and export", () => {
  it("round-trips a venue through export and import", () => {
    const venue = emptyVenue(rectangleRoom(5, 5));
    const exported = exportVenue(venue);
    // A real JSON round trip: an in-memory passthrough (no serialization)
    // would fail here, and the export must stay JSON-safe by contract.
    const back = importVenue(JSON.parse(JSON.stringify(exported)) as ReturnType<typeof exportVenue>);

    expect(back).toEqual(venue);
  });

  it("rejects foreign venue files with a typed error", () => {
    const room = emptyVenue(rectangleRoom(5, 5));
    // One deviation per case, so a failure names the guard that fired: wrong
    // format with a valid version, then the right format with a wrong version.
    expect(() => importVenue({ format: "other", version: 1, venue: room } as never)).toThrow(
      /unsupported venue file/,
    );
    expect(() => importVenue({ format: "autolight-venue", version: 9, venue: room } as never)).toThrow(
      /unsupported venue file/,
    );
  });

  it("persists logical zero moves across the round trip", () => {
    const venue = setLogicalZero(emptyVenue(rectangleRoom(5, 5)), 0.3);
    const back = importVenue(JSON.parse(JSON.stringify(exportVenue(venue))) as ReturnType<typeof exportVenue>);

    expect(back.logicalZeroS).toBeCloseTo(0.3, 9);
    expect(back.room.logicalZeroS).toBeCloseTo(0.3, 9);
    // Out-of-range input wraps around the perimeter instead of persisting raw.
    const wrapped = setLogicalZero(emptyVenue(rectangleRoom(5, 5)), 1.3);

    expect(wrapped.logicalZeroS).toBeCloseTo(0.3, 9);
  });
});
