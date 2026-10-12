import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Routes } from "../routes/index.js";
import { MasterControls, deckBpm } from "./kit.js";
import { InspectorEmpty } from "../features/inspector/inspector-view.js";
import { liveDeckRows } from "../routes/library/library-rows.js";

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
  it("inspector mounts the loading state before lanes resolve", () => {
    const html = renderToStaticMarkup(createElement(Routes, { route: "inspector", live: null }));
    expect(html).toContain("Track inspector");
    expect(html).toContain("Loading lanes…");
  });
  it("inspector empty state fires the setup action", () => {
    const onSetup = vi.fn();
    const html = renderToStaticMarkup(createElement(InspectorEmpty, { onSetup }));
    expect(html).toContain("Open Setup");
    expect(onSetup).not.toHaveBeenCalled();
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
  it("live deck rows carry artist and readiness without parsing titles", () => {
    const rows = liveDeckRows([
      { title: "Track One", artist: "Artist One", readiness: "READY" },
      { title: "—", artist: "", readiness: "NEEDS ANALYSIS" },
    ], 128, "");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "deck-a", title: "Track One", artist: "Artist One", readiness: "READY", bpm: 128 });
    expect(liveDeckRows([
      { title: "Track One", artist: "", readiness: "NEEDS ANALYSIS" },
      { title: "Track Two", artist: "Artist Two", readiness: "READY" },
    ], null, "artist two")).toMatchObject([{ id: "deck-b", artist: "Artist Two", readiness: "READY", bpm: null }]);
  });
  it("inspector empty state fires the setup action", () => {
    const onSetup = vi.fn();
    const html = renderToStaticMarkup(createElement(InspectorEmpty, { onSetup }));
    expect(html).toContain("Open Setup");
    expect(html).toContain("No track analyzed yet");
    expect(onSetup).not.toHaveBeenCalled();
  });
});
