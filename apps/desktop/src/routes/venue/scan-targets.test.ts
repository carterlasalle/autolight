import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VenueView } from "../../features/venue/venue-view.js";

describe("venue scan targets", () => {
  it("renders the scan-targets input with save", () => {
    const html = renderToStaticMarkup(createElement(VenueView));
    expect(html).toContain("Find lights");
    expect(html).toContain("Scan targets (IPs or hostnames)");
    expect(html).toContain("Scan the LAN");
    expect(html).toContain("Targets");
  });
});
