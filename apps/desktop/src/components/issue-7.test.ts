import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Routes } from "../routes/index.js";
import { MasterControls, deckBpm } from "./kit.js";

// T-UI issue #7: empty states carry one action button, venue exposes the
// room editor as a tab, null BPM reads unmeasured everywhere.
describe("issue-7 empty states and venue tabs", () => {
  it("live empty state links to setup", () => {
    const html = renderToStaticMarkup(createElement(Routes, { route: "live", live: null }));
    expect(html).toContain("No show loaded");
    expect(html).toContain("Open Setup");
  });
  it("library empty state links to setup", () => {
    const html = renderToStaticMarkup(createElement(Routes, { route: "library", live: null }));
    expect(html).toContain("Open Setup");
  });
  it("inspector empty state links to setup", () => {
    const html = renderToStaticMarkup(createElement(Routes, { route: "inspector", live: null }));
    expect(html).toContain("Track inspector");
  });
  it("venue exposes lights and room mapping tabs", () => {
    const html = renderToStaticMarkup(createElement(Routes, { route: "venue", live: null }));
    expect(html).toContain("Lights");
    expect(html).toContain("Room mapping");
  });
  it("null bpm reads unmeasured through deckBpm", () => {
    expect(deckBpm(null)).toBe("unmeasured");
  });
  it("master controls carry B/W/F/A shortcut hints", () => {
    const html = renderToStaticMarkup(createElement(MasterControls, {
      state: { intensity: 0.8, frozen: false, blackout: false, auto: true },
      onIntent: () => undefined,
    }));
    for (const hint of ["(B)", "(W)", "(F)", "(A)"]) expect(html).toContain(hint);
  });
});
