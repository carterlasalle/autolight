import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { LiveState, Route } from "../app/store.js";
import { Routes } from "./index.js";

// The route table is exhaustive by type; this test proves each route renders
// its own screen, so a mis-wired import or a duplicated entry fails here
// instead of showing a blank workspace. Markers are screen-unique substrings
// (a mis-wired screen fails the positive check AND trips on another screen's
// marker via the negative cross-screen check below).
const ROUTES = ["live", "library", "inspector", "venue", "setup", "diagnostics", "settings"] as const;

const MARKERS: Record<Route, string> = {
  live: "No show loaded",
  library: "Preanalysis queue",
  inspector: "Track inspector",
  venue: "Find lights",
  setup: "Follow mode",
  diagnostics: "Diagnostics",
  settings: "Search settings",
};

const POPULATED_LIVE: LiveState = {
  source: "REKORDBOX",
  bpm: 124,
  beat: 8,
  deckA: { title: "Deck A track", artist: "A", readiness: "READY", bpm: 124, section: "Chorus", countdown: "in 4 beats" },
  deckB: { title: "Deck B track", artist: "B", readiness: "READY", bpm: 124, section: "Verse", countdown: "in 8 beats" },
  cues: [{ type: "drop-hit", startBeat: 16, durationBeats: 4, intensity: 1, target: "Both", priority: 1 }],
  cells: [{ x: 0, color: "#ffffff" }],
  palette: [[255, 200, 0]],
};

function render(route: Route, live: LiveState | null): string {
  return renderToStaticMarkup(createElement(Routes, { route, live }));
}

describe("routes", () => {
  it("renders each route's own screen", () => {
    for (const route of ROUTES) {
      expect(render(route, null), `route ${route}`).toContain(MARKERS[route]);
    }
  });

  it("each screen's marker appears only on its own route", () => {
    for (const route of ROUTES) {
      for (const other of ROUTES) {
        if (other === route) continue;
        expect(render(other, null), `${other} must not contain ${route}'s marker`).not.toContain(MARKERS[route]);
      }
    }
  });

  it("renders the populated live branch without the empty state", () => {
    const html = render("live", POPULATED_LIVE);
    expect(html).not.toContain("No show loaded");
    expect(html).toContain("124.0");
    expect(html).toContain("Deck A track");
  });
});
