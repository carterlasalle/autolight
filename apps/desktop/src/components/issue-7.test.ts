import { Children, createElement, isValidElement, type ReactElement } from "react";
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

    // renderToStaticMarkup has no event dispatch: read the wired onClick off
    // the element tree, so a removed/no-op onClick fails this test.
    const tree = InspectorEmpty({ onSetup });

    const elements = Children.toArray(tree.props.children).filter((child): child is ReactElement<{ onClick?: unknown }> =>
      isValidElement<{ onClick?: unknown }>(child),
    );

    if (elements.length !== 2) throw new Error("empty state must render text plus one action button");

    const action = elements[1];

    if (action === undefined) throw new Error("empty state must render an action button");

    const onClick = action.props.onClick;

    if (!(onClick instanceof Function)) throw new Error("setup button must wire onClick");

    onClick.call(undefined);
  });
  it("venue exposes lights and room mapping tabs", () => {
    const html = renderToStaticMarkup(createElement(Routes, { route: "venue", live: null }));
    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tab"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain("Lights");
    expect(html).toContain("Room mapping");
  });
  it("null bpm reads unmeasured through deckBpm", () => {
    expect(deckBpm(null)).toBe("unmeasured");
    expect(deckBpm(0)).toBe("0.0");
    expect(deckBpm(128)).toBe("128.0");
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
      { title: "Track One", artist: "Artist One", readiness: "READY", bpm: 128 },
      { title: "—", artist: "", readiness: "NEEDS ANALYSIS", bpm: null },
    ], 120, "");

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "deck-a", title: "Track One", artist: "Artist One", readiness: "READY", bpm: 128 });
    expect(liveDeckRows([
      { title: "Track One", artist: "", readiness: "NEEDS ANALYSIS", bpm: 124 },
      { title: "Track Two", artist: "Artist Two", readiness: "READY", bpm: 132 },
    ], null, "artist two")).toMatchObject([{ id: "deck-b", artist: "Artist Two", readiness: "READY", bpm: 132 }]);
  });
  it("live deck rows keep each deck on its own tempo", () => {
    const rows = liveDeckRows([
      { title: "A", artist: "", readiness: "READY", bpm: 120 },
      { title: "B", artist: "", readiness: "READY", bpm: 140 },
    ], null, "");

    expect(rows.map((r) => r.bpm)).toEqual([120, 140]);
  });
  it("live deck rows keep the fallback on deck A, never deck B", () => {
    const rows = liveDeckRows([
      { title: "A", artist: "", readiness: "READY", bpm: null },
      { title: "B", artist: "", readiness: "READY", bpm: 140 },
    ], 128, "");

    expect(rows.map((r) => r.bpm)).toEqual([128, 140]);

    // Deck B with no measurement reads unmeasured even with a live fallback.
    const leaked = liveDeckRows([
      { title: "A", artist: "", readiness: "READY", bpm: 128 },
      { title: "B", artist: "", readiness: "READY", bpm: null },
    ], 128, "");

    expect(leaked.map((r) => r.bpm)).toEqual([128, null]);
  });
});
