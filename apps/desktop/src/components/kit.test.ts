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
import type { TrackModel, ShowCue } from "@autolight/contracts";

const render = (node: ReactElement): string => renderToStaticMarkup(node);

const track = {
  identity: { id: "t1", title: "Track" },
  sections: [{ kind: "chorus", startBeat: 0, endBeat: 32 }],
  musicalEvents: [{ type: "drop", beat: 32 }],
  beatGrid: { beats: [{ index: 0, beatInBar: 1 }] },
} as unknown as TrackModel;

const cue = {
  type: "section-look", startBeat: 8, durationBeats: 32,
  intensity: 0.8, target: "PRIMARY", priority: 10,
} as unknown as ShowCue;

describe("StatusDot", () => {
  it("renders its label next to the dot", () => {
    const html = render(createElement(StatusDot, { tone: "ok", label: "online" }));
    expect(html).toContain(tokenForTone("ok"));
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
    expect(html.match(/left:0%/g)?.length ?? 0).toBeGreaterThan(0);
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
    const html = render(createElement(DeviceTile, { tile, onAction: () => undefined }));
    expect(html).toContain("IDENTIFY");
    expect(html).toContain("TEST CHASE");
    expect(html).toContain("RECALIBRATE");
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
    expect(html).toContain("blackout");
    expect(html).toContain("full white");
    expect(html).toContain("auto");
    expect(html).toContain("intensity 80%");
  });
  it("labels a missing intensity unmeasured instead of guessing", () => {
    const html = render(createElement(MasterControls, {
      state: { intensity: null, frozen: false, blackout: false, auto: false },
      onIntent: () => undefined,
    }));
    expect(html).toContain("intensity unmeasured");
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
    expect(html).toContain("receipt: spec");
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
    expect(unverified).toContain("SERATO serato-remote UNVERIFIED REKORDBOX VERSION");
  });
});

describe("emergency controls (T-UI-03)", () => {
  it("shortcut map fires the four implemented emergency intents", async () => {
    // Regression for F-APP-17: the palette's Emergency items used to close
    // the palette without firing anything. Both surfaces share this map, so
    // the palette's fire() targets (command-palette.tsx) must stay in it.
    const { SHORTCUTS } = await import("../app/shortcuts.js");
    expect(SHORTCUTS).toMatchObject({
      b: "master/blackout",
      w: "master/full",
      f: "master/freeze",
      a: "master/resume",
    });
  });
  it("shortcut map names only implemented channels", async () => {
    const { SHORTCUTS } = await import("../app/shortcuts.js");
    const { channels } = await import("@autolight/ipc");
    for (const channel of Object.values(SHORTCUTS)) {
      expect(channel in channels).toBe(true);
    }
  });
});
