import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Route } from "../app/store.js";
import { Routes } from "./index.js";

// The route table is exhaustive by type; this test proves each route renders
// its own screen, so a mis-wired import or a duplicated entry fails here
// instead of showing a blank workspace.
const MARKERS: [Route, string][] = [
  ["live", "No show loaded"],
  ["library", "Library"],
  ["inspector", "Track inspector"],
  ["venue", "Lights"],
  ["setup", "Follow mode"],
  ["diagnostics", "Diagnostics"],
  ["settings", "Settings:"],
];

describe("routes", () => {
  it("renders each route's own screen", () => {
    for (const [route, marker] of MARKERS) {
      const html = renderToStaticMarkup(createElement(Routes, { route, live: null }));
      expect(html, `route ${route}`).toContain(marker);
    }
  });
});
