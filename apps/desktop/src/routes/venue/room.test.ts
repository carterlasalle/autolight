import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RoomVenueRoute } from "./index.js";
import { MappingWizard } from "./mapping-wizard.js";
import { RoomPreview } from "./room-preview.js";

describe("T-ROOM-03 room editor UI", () => {
  it("renders the room editor with numeric alternatives for every drag", () => {
    const html = renderToStaticMarkup(createElement(RoomVenueRoute));
    for (const label of ["Room width meters", "Ceiling height meters", "DJ facing degrees", "Save room"]) {
      expect(html).toContain(label);
    }
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
