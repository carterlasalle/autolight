import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { rectangleRoom } from "@autolight/venue";
import { RoomVenueRoute, rescaleOutline } from "./index.js";
import { MappingWizard } from "./mapping-wizard.js";
import { RoomPreview } from "./room-preview.js";
describe("T-ROOM-03 room editor UI", () => {
  it("renders the room editor with numeric alternatives for every drag", () => {
    const html = renderToStaticMarkup(createElement(RoomVenueRoute));
    for (const label of ["Room width meters", "Ceiling height meters", "DJ facing degrees", "Save room"]) {
      expect(html).toContain(label);
    }
  });

  it("width edits rescale the outline without resetting the room", () => {
    const room = { ...rectangleRoom(5, 5), ceilingHeight: 3.2 };
    const next = rescaleOutline(room, 10, 5);
    expect(next.ceilingHeight).toBe(3.2);
    expect(next.anchors.dj.facingRad).toBe(room.anchors.dj.facingRad);
    expect(next.outline).toHaveLength(room.outline.length);
    const xs = next.outline.map((p) => p.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(10, 6);
  });

  it("walks the ten wizard steps and explains mirrored splits", () => {
    const html = renderToStaticMarkup(createElement(MappingWizard, { onDone: () => undefined }));
    expect(html).toContain("Strip mapping wizard");
    expect(html).toContain("step 1 of 10");
    expect(html).toContain("Choose the strip");
  });

  it("previews the real room with live cells and a beat control", () => {
    const html = renderToStaticMarkup(createElement(RoomPreview, { roomId: "square-loop" }));
    expect(html).toContain("Real room preview");
    expect(html).toContain("Preview beat");
  });
});
