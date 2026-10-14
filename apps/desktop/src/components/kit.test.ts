import { describe, expect, it } from "vitest";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  barTicks, CAPABILITY_STATUSES, CapabilityBadge, ConfigField, cueRelative, CueList,
  deckBpm, DeckPanel, DecisionSwitch, DeviceTile, EventLane, FixturePreview,
  HealthIndicator, InspectorPanel, masterIntensity, MasterControls, MetricBadge,
  metricText, receiptLabel, SectionLane, BeatRuler, SourceBadge, StatusDot,
  TimelineCursor, tokenForTone, UNVERIFIED_REKORDBOX_COPY, Waveform,
} from "./kit.js";
import { SHORTCUTS } from "../app/shortcuts.js";
import { channels } from "@autolight/ipc";
import type { TrackModel, ShowCue } from "@autolight/contracts";

const render = (node: ReactElement): string => renderToStaticMarkup(node);

// Fixtures satisfy the contract types with no casts, so a renamed/removed
// contract field fails the build instead of passing against a stale mock.
const track: TrackModel = {
  schemaVersion: 2,
  analyzerVersion: "kit-test",
  identity: { id: "t1", sourceIds: {}, title: "Track" },
  durationSeconds: 200,
  beatGrid: { version: 1, beats: [{ index: 0, beatInBar: 1, sourceTimeMs: 0, bpm: 128 }] },
  sections: [{ kind: "chorus", startBeat: 0, endBeat: 32, confidence: 0.9 }],
  musicalEvents: [{ type: "drop", beat: 32, confidence: 0.9 }],
  analysisCoverage: "structured",
  readinessLevel: "structured",
  analysisCoverage2: {
    level: "structured",
    inputs: {
      "source.audio": { status: "absent" },
      "native.rekordbox.grid": { status: "absent" },
      "native.rekordbox.pssi": { status: "absent" },
      "native.rekordbox.cues": { status: "absent" },
      "native.rekordbox.waveforms": { status: "absent" },
      "native.rekordbox.vocal": { status: "absent" },
      "native.serato.grid": { status: "absent" },
      "native.serato.markers": { status: "absent" },
      "ml.allinone.structure": { status: "absent" },
      "ml.allinone.metrical": { status: "absent" },
      "ml.allinone.activations": { status: "absent" },
      "ml.allinone.embeddings": { status: "absent" },
      "ml.stems": { status: "absent" },
      "ml.beatthis": { status: "absent" },
      "dsp.features": { status: "absent" },
      "dsp.stemProxies": { status: "absent" },
      "events.detectors": { status: "absent" },
      "fusion.structure": { status: "absent" },
      "plan.generated": { status: "absent" },
    },
  },
  gridWarnings: [],
  beatFeatures: [],
  phrases: [],
};

const cue: ShowCue = {
  type: "section-look", startBeat: 8, durationBeats: 32,
  intensity: 0.8, target: "PRIMARY", priority: 10,
};

describe("StatusDot", () => {
  it("renders its label next to the dot", () => {
    const html = render(createElement(StatusDot, { tone: "ok", label: "online" }));
    expect(html).toContain("online");
    // Independent of tokenForTone(): the concrete token for `ok` pins the
    // mapping, so a broken switch (e.g. `ok` returning the warn/bad token)
    // fails instead of passing against itself.
    expect(html).toContain("var(--ok)");
  });
  it("maps every tone to a distinct token", () => {
    const tones = ["neutral", "ok", "warn", "bad"] as const;
    expect(new Set(tones.map(tokenForTone)).size).toBe(4);
  });
});

describe("MetricBadge", () => {
  it("labels a missing measurement unmeasured", () => {
    expect(metricText({ label: "latency", value: null, unit: "ms" })).toBe("latency: unmeasured");
    expect(render(createElement(MetricBadge, {
      metric: { label: "latency", value: null, unit: "ms" },
    }))).toContain("latency: unmeasured");
  });
  it("renders measured values with their unit", () => {
    expect(metricText({ label: "fps", value: "60", unit: "fps" })).toBe("fps: 60fps");
  });
});

describe("DeckPanel", () => {
  it("renders the deck title, section, countdown and bpm", () => {
    const html = render(createElement(DeckPanel, {
      deck: {
        title: "Deck 1", subtitle: "Rekordbox", bpm: 128,
        section: "Chorus", countdown: "DROP IN 8", health: "ok",
      },
    }));

    expect(html).toContain("Deck 1");
    expect(html).toContain("Chorus");
    expect(html).toContain("DROP IN 8");
    expect(html).toContain("128.0");
  });
  it("labels a null bpm unmeasured", () => {
    expect(deckBpm(null)).toBe("unmeasured");
    expect(deckBpm(128.04)).toBe("128.0");
  });
});

describe("Waveform", () => {
  it("renders a polyline and a playhead for measured points", () => {
    const html = render(createElement(Waveform, {
      points: [{ at: 0, value: 0.5 }, { at: 4, value: 1 }],
      beat: 2,
    }));

    expect(html).toContain("<polyline");
    expect(html).toContain("<line");
    expect(html).toContain('aria-label="Waveform"');
  });
  it("renders an empty axis with no points", () => {
    const html = render(createElement(Waveform, { points: [], beat: 0 }));
    expect(html).not.toContain("<polyline");
    expect(html).toContain("<line");
  });
});

describe("BeatRuler", () => {
  it("renders one tick per beat with bars distinct from beats", () => {
    const ticks = barTicks(0, 4);
    expect(ticks).toEqual([{ at: 0 }, { at: 1 }, { at: 2 }, { at: 3 }, { at: 4 }]);

    const html = render(createElement(BeatRuler, {
      ticks, startBeat: 0, endBeat: 4, beatsPerBar: 4,
    }));

    expect(html).toContain('aria-label="Beat ruler"');
    // Bar ticks render taller/brighter than beat ticks (h-3 bg-foreground vs
    // h-1.5 bg-muted-foreground); a regression collapsing the two styles fails.
    expect(html).toContain("h-3");
    expect(html).toContain("h-1.5");
    expect(html.match(/left:0%/g)?.length ?? 0).toBe(1);
  });
});

describe("SectionLane", () => {
  it("renders one band per section", () => {
    const html = render(createElement(SectionLane, {
      bands: [{ start: 0, end: 32, label: "chorus" }],
      startBeat: 0, endBeat: 32,
    }));

    expect(html).toContain("chorus");
    expect(html).toContain('aria-label="Sections"');
  });
});

describe("EventLane", () => {
  it("renders one mark per event with its label", () => {
    const html = render(createElement(EventLane, {
      marks: [{ at: 32, label: "drop", kind: "event" }],
      startBeat: 0, endBeat: 64,
    }));

    expect(html).toContain('title="drop"');
    expect(html).toContain('aria-label="Events"');
  });
});

describe("FixturePreview", () => {
  it("renders one rect per cell", () => {
    const html = render(createElement(FixturePreview, {
      rows: [{ cells: [{ x: 0, color: "#fff" }, { x: 1, color: "#000" }] }],
    }));

    expect(html.match(/<rect/g)?.length ?? 0).toBe(2);
  });
  it("handles 2,000 cells without one div per cell", () => {
    const cells = Array.from({ length: 2000 }, (_, x) => ({ x, color: "#123456" }));
    const html = render(createElement(FixturePreview, { rows: [{ cells }] }));
    expect(html.match(/<rect/g)?.length ?? 0).toBe(2000);
    expect(html).not.toContain("data-x=");
  });
});

describe("DeviceTile", () => {
  const tile = {
    id: "10.0.0.2", sku: "H6076", ip: "10.0.0.2", firmware: "1.2.3",
    name: "Lamp", enabled: true,
    segments: 14, fps: 30, sentFrames: 100, supersededFrames: 5,
    latencyMs: 25, health: "online" as const,
  };

  it("renders identity, health and measured latency", () => {
    const html = render(createElement(DeviceTile, { tile }));
    expect(html).toContain("10.0.0.2");
    expect(html).toContain("health: online");
    expect(html).toContain("latency: 25ms");
  });
  it("wires the three device actions through one handler", () => {
    // Static markup strips event handlers, so labels alone cannot prove the
    // buttons call onAction with the right id. Assert the wiring structurally:
    // three buttons, in IDENTIFY/TEST CHASE/RECALIBRATE order, and the tile
    // hides the action row entirely when no handler is wired.
    const html = render(createElement(DeviceTile, { tile, onAction: () => undefined }));
    const buttons = [...html.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map((m) => m[1]);
    expect(buttons).toEqual(["IDENTIFY", "TEST CHASE", "RECALIBRATE"]);
    expect(render(createElement(DeviceTile, { tile }))).not.toContain("<button");
  });
});

describe("HealthIndicator", () => {
  it("renders the health word next to its dot", () => {
    const html = render(createElement(HealthIndicator, { tone: "bad", label: "health: offline" }));
    expect(html).toContain("health: offline");
  });
});

describe("InspectorPanel", () => {
  it("renders lanes from the installed track model", () => {
    const html = render(createElement(InspectorPanel, {
      track, startBeat: 0, endBeat: 32,
    }));

    expect(html).toContain("Track");
    expect(html).toContain("chorus");
    expect(html).toContain('aria-label="Sections"');
    expect(html).toContain('aria-label="Events"');
  });
});

describe("TimelineCursor", () => {
  it("positions the playhead from measured props", () => {
    expect(render(createElement(TimelineCursor, { at: 4, end: 8 }))).toContain("left:50%");
    expect(render(createElement(TimelineCursor, { at: 0, end: 0 }))).toContain("left:0%");
  });
});

describe("CueList", () => {
  it("renders relative times in beats", () => {
    expect(cueRelative(cue, 8)).toBe("in now");
    expect(cueRelative(cue, 0)).toBe("in 8 beats");

    const html = render(createElement(CueList, {
      cues: [{ cue, now: 0 }], now: 0,
    }));

    expect(html).toContain("section look");
    expect(html).toContain("in 8 beats");
  });
});

describe("MasterControls", () => {
  it("renders the emergency intents with the real intensity value", () => {
    expect(masterIntensity(null)).toBe("unmeasured");
    expect(masterIntensity(0.8)).toBe("80%");

    const html = render(createElement(MasterControls, {
      state: { intensity: 0.8, frozen: false, blackout: false, auto: true },
      onIntent: () => undefined,
    }));

    expect(html).toContain("Blackout");
    expect(html).toContain("Full white");
    expect(html).toContain("Auto");
    expect(html).toContain("Intensity");
    expect(html).toContain("80%");
  });
  it("labels a missing intensity unmeasured instead of guessing", () => {
    const html = render(createElement(MasterControls, {
      state: { intensity: null, frozen: false, blackout: false, auto: false },
      onIntent: () => undefined,
    }));

    expect(html).toContain("Intensity");
    expect(html).toContain("unmeasured");
  });
});

describe("ConfigField", () => {
  it("renders key, value, unit, range, receipt and live safety", () => {
    expect(receiptLabel("spec 88")).toBe("spec");
    expect(receiptLabel("measured on device")).toBe("measured");
    expect(receiptLabel("unmeasured")).toBe("unmeasured");
    expect(receiptLabel("upstream")).toBe("other");

    const html = render(createElement(ConfigField, {
      def: {
        key: "ui.live.minTimingFontPx", value: "48", unit: "px",
        range: "24 to 96", receipt: "spec 88", liveSafe: true,
      },
    }));

    expect(html).toContain("ui.live.minTimingFontPx");
    expect(html).toContain("spec");
    expect(html).toContain("live-safe");
  });
});

describe("DecisionSwitch", () => {
  it("renders every mode with its measurement and marks the current one", () => {
    const html = render(createElement(DecisionSwitch, {
      decision: {
        id: "DS-01", current: "a",
        modes: [
          { id: "a", label: "Mode A", measurement: "10 ms" },
          { id: "b", label: "Mode B", measurement: "20 ms" },
        ],
      },
    }));

    expect(html).toContain("Mode A");
    expect(html).toContain("10 ms");
    expect(html).toContain("Mode B");
    expect(html).toContain("current");
  });
});

describe("CapabilityBadge", () => {
  it("renders the truthful capability status vocabulary", () => {
    expect(CAPABILITY_STATUSES).toEqual([
      "PASS", "IMPLEMENTED_UNQUALIFIED", "PARTIAL",
      "FAIL", "UNAVAILABLE_ON_THIS_DEVICE", "MISSING",
    ]);

    const html = render(createElement(CapabilityBadge, {
      capability: "govee-lan", status: "PARTIAL",
    }));

    expect(html).toContain("govee-lan: PARTIAL");
  });
});

describe("SourceBadge", () => {
  it("renders source, provider and quality", () => {
    expect(UNVERIFIED_REKORDBOX_COPY).toBe("UNVERIFIED REKORDBOX VERSION");

    const verified = render(createElement(SourceBadge, {
      info: { source: "REKORDBOX", provider: "prolink", verified: true },
    }));

    expect(verified).toContain("REKORDBOX prolink verified");

    const unverified = render(createElement(SourceBadge, {
      info: { source: "SERATO", provider: "serato-remote", verified: false },
    }));

    // The spec-145 banner wording is Rekordbox-specific; Serato reads plain
    // "unverified" (batch-05).
    expect(unverified).toContain("SERATO serato-remote unverified");

    const unverifiedRekordbox = render(createElement(SourceBadge, {
      info: { source: "REKORDBOX", provider: "prolink", verified: false },
    }));

    expect(unverifiedRekordbox).toContain(`REKORDBOX prolink ${UNVERIFIED_REKORDBOX_COPY}`);
  });
});

describe("emergency controls (T-UI-03)", () => {
  it("shortcut map fires the four implemented emergency intents", () => {
    // The palette's Emergency items call fire() with literal channel strings
    // (command-palette.tsx), they do not import SHORTCUTS, so this map alone
    // cannot prove the palette fires. Pin the four palette literals here so a
    // removed/renamed emergency channel fails fast at the authored literal.
    expect(SHORTCUTS).toMatchObject({
      b: "master/blackout",
      w: "master/full",
      f: "master/freeze",
      a: "master/resume",
    });

    for (const channel of ["master/blackout", "master/full", "master/freeze", "master/resume"] as const) {
      expect(Object.prototype.hasOwnProperty.call(channels, channel)).toBe(true);
    }
  });
  it("shortcut map names only implemented channels", () => {
    for (const channel of Object.values(SHORTCUTS)) {
      expect(Object.prototype.hasOwnProperty.call(channels, channel)).toBe(true);
    }
  });
});
