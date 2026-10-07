import { describe, expect, it } from "vitest";
import { auditionAtBeat, blendView, inspectorDefaults, redoPop, undoStack } from "./inspector-helpers.js";
import type { TrackModel } from "@autolight/contracts";

const track = {
  identity: { id: "t1", sourceIds: {} },
  sections: [{ kind: "chorus", startBeat: 0, endBeat: 512, confidence: 0.9 }],
  musicalEvents: [],
  beatGrid: { beats: [{ index: 0, beatInBar: 1, sourceTimeMs: 0, bpm: 128 }] },
} as unknown as TrackModel;

const cues = [
  { type: "section-look", startBeat: 0 },
  { type: "white-hit", startBeat: 256 },
];

describe("inspector helpers (T-UI-06/07)", () => {
  it("auditions beat 257 against the beat-256 cue (P-96)", () => {
    const pick = auditionAtBeat(track, cues, 257, false);
    expect(pick).toMatchObject({ beat: 257, cueType: "white-hit", sendToLights: false });
  });
  it("clamps out-of-range beats and refuses no-track audition", () => {
    expect(auditionAtBeat(null, cues, 10, false)).toBeNull();
    expect(auditionAtBeat(track, cues, 9999, false)?.beat).toBe(512);
  });
  it("mixes blend-space A/B within bounds", () => {
    expect(blendView("club", "house", 1.4).mix).toBe(1);
    expect(blendView("club", "house", -1).mix).toBe(0);
  });
  it("pushes and pops undo history", () => {
    const s = undoStack([], [{ op: "add-drop", beat: 32 }]);
    const { head, rest } = redoPop(s);
    expect(head).toHaveLength(1);
    expect(rest).toHaveLength(0);
    expect(redoPop([]).head).toBeNull();
  });
  it("seeds audition and correction beats from the track, not fixtures", () => {
    const withEvents = {
      identity: { id: "t1", sourceIds: {} },
      sections: [{ kind: "chorus", startBeat: 32, endBeat: 64, confidence: 0.9 }],
      musicalEvents: [
        { type: "drop", beat: 40, confidence: 0.9 },
        { type: "build", beat: 48, confidence: 0.9 },
      ],
      beatGrid: { beats: [{ index: 0, beatInBar: 1, sourceTimeMs: 0, bpm: 128 }] },
    } as unknown as TrackModel;
    expect(inspectorDefaults(withEvents)).toEqual({ beat: 40, dropBeat: 40, nextBeat: 48, sectionStart: 32, sectionEnd: 64 });
    const sectionsOnly = {
      identity: { id: "t2", sourceIds: {} },
      sections: [{ kind: "intro", startBeat: 16, endBeat: 48, confidence: 0.9 }],
      musicalEvents: [],
      beatGrid: { beats: [] },
    } as unknown as TrackModel;
    expect(inspectorDefaults(sectionsOnly).beat).toBe(16);
    expect(inspectorDefaults(null).beat).toBe(0);
  });
});
