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

    // The drag alternative must be a working numeric input, not just a
    // label: pin the control's own attributes (order-independent) for the
    // width field (batch-15).
    const widthInput = /<input[^>]*aria-label="Room width meters"[^>]*>/.exec(html)?.[0] ?? "";
    expect(widthInput).toContain('type="number"');
    expect(widthInput).toContain('step="0.1"');
  });

  it("width edits rescale the outline without resetting the room", () => {
    const room = { ...rectangleRoom(5, 5), ceilingHeight: 3.2 };
    const next = rescaleOutline(room, 10, 5);
    expect(next.ceilingHeight).toBe(3.2);
    expect(next.anchors.dj.facingRad).toBe(room.anchors.dj.facingRad);
    expect(next.outline).toHaveLength(room.outline.length);
    const xs = next.outline.map((p) => p.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(10, 6);

    // Degenerate drag products fall back to the current dimensions instead
    // of corrupting the room: zero, negative and NaN targets (batch-15).
    for (const bad of [0, -5, Number.NaN]) {
      const kept = rescaleOutline(room, bad, bad);
      const keptXs = kept.outline.map((p) => p.x);
      const keptYs = kept.outline.map((p) => p.y);
      expect(Math.max(...keptXs) - Math.min(...keptXs)).toBeCloseTo(5, 6);
      expect(Math.max(...keptYs) - Math.min(...keptYs)).toBeCloseTo(5, 6);
      expect(kept.anchors.dj.facingRad).toBe(room.anchors.dj.facingRad);
    }
  });

  it("renders the wizard shell on its first step", () => {
    // Static render only: Next/Back navigation and the mirrored-split copy
    // live behind interaction this harness cannot drive, so the title names
    // exactly what is proven (batch-15).
    const html = renderToStaticMarkup(createElement(MappingWizard, { onDone: () => undefined }));
    expect(html).toContain("Strip mapping wizard");
    expect(html).toContain("step 1 of 10");
    expect(html).toContain("Choose the strip");
  });

  it("renders the preview shell with its beat control", () => {
    // Static markup can prove the control exists, not that onChange drives
    // the cells; the title says exactly that (batch-15).
    const html = renderToStaticMarkup(createElement(RoomPreview, { roomId: "square-loop" }));
    expect(html).toContain("Real room preview");
    expect(html).toContain("Preview beat");
    expect(html).toMatch(/<input[^>]*aria-label="Preview beat"/);
  });
});
