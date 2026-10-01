import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Shell } from "./shell.js";

// The shell is the app root (spec 83 src/app): titlebar, sidebar, workspace
// and statusbar. Rendering it proves the restructured imports resolve and the
// default route shows its screen.
describe("shell", () => {
  it("renders the frame with the default route", () => {
    const html = renderToStaticMarkup(createElement(Shell));
    expect(html).toContain("AutoLight");
    expect(html).toContain("aria-label=\"Routes\"");
    expect(html).toContain("No show loaded");
  });
});
