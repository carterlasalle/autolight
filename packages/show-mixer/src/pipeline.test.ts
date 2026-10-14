import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { trackModelSchema, showStyleSchema, type Fixture } from "@autolight/contracts";
import { planShow, validatePlan, BUILT_IN_STYLES } from "@autolight/show-planner";
import { renderFrame, frameHash } from "@autolight/renderer";
import { makeDeck, makeFixture } from "@autolight/simulator";
import { Store } from "@autolight/storage";
import { loadFastPath, impactOwner, mixDown, type MixResult } from "./index.js";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "test-fixtures", "analysis");

/** Fixture loads are schema-parsed once here; a missing or legacy fixture
 *  fails with its path in the ENOENT message, never a silent substitute. */
function loadFixture(name: string): ReturnType<typeof trackModelSchema.parse> {
  return trackModelSchema.parse(JSON.parse(readFileSync(join(dir, name), "utf8")));
}

function groupedFixture(id: string, x: number, groups: string[]): Fixture {
  const f = makeFixture(id, 14, x, x);

  return { ...f, groups };
}

describe("pipeline", () => {
  it("plans a valid show from the real track", () => {
    const track = loadFixture("real-track-1.trackmodel.json");
    const style = showStyleSchema.parse(BUILT_IN_STYLES.club);
    const plan = planShow(track, style);
    expect(plan.cues.length).toBeGreaterThan(0);
    expect(validatePlan(plan, track.beatGrid.beats.length)).toEqual([]);
    const frames = renderFrame(plan, 40, [makeFixture("f", 14)]);
    expect(frameHash(frames)).toMatch(/^[0-9a-f]{8}$/);
  });
  it("loads cached track+plan on the fast path (§138)", () => {
    const store = new Store();
    const track = loadFixture("real-track-1.trackmodel.json");
    store.saveArtifact("real-track-1", "0.1.0", "/cache/real.json", "fp1");
    // The real identity JSON, not a truncated fragment: a stored row must be
    // what a reader could actually parse.
    store.saveTrack("real-track-1", JSON.stringify(track.identity), track.durationSeconds);
    const style = showStyleSchema.parse(BUILT_IN_STYLES.club);
    const plan = planShow(track, style);
    store.saveShowPlan("real-track-1", "club", plan.plannerVersion, plan.seed, JSON.stringify(plan));
    const loaded = loadFastPath(store, "real-track-1", "0.1.0", "fp1", "club", plan.plannerVersion);
    expect(loaded.trackJson).toBe("/cache/real.json");
    expect(JSON.parse(loaded.planJson!).trackId).toBe("real-track-1");
    expect(loadFastPath(store, "missing", "0.1.0", "fp1", "club", plan.plannerVersion)).toEqual({ trackJson: null, planJson: null });
    store.close();
  });
  it("gives drop impact to the incoming deck", () => {
    const track = loadFixture("real-track-1.trackmodel.json");
    const style = showStyleSchema.parse(BUILT_IN_STYLES.club);
    const plan = planShow(track, style);
    const a = makeDeck({ deckId: 1, channelFader: 0.2, crossfader: 1, track: { id: "old", sourceIds: {} } });
    const b = makeDeck({ deckId: 2, channelFader: 1, crossfader: 1, track: { id: "real-track-1", sourceIds: {} } });
    const owner = impactOwner({ state: a, strength: 0.4 }, { state: b, strength: 0.9 });
    expect(owner).toBe("b");
    // The render follows the elected owner: B's plan cues are the ones that
    // light the rig at the drop.
    const ownerPlan = owner === "b" ? plan : { ...plan, cues: [] };
    const frames = renderFrame(ownerPlan, 120, [groupedFixture("left", 0, ["PRIMARY"]), groupedFixture("right", 1, ["SECONDARY"])]);
    expect([...frames.get("left")!].some((v) => v > 0)).toBe(true);
  });
  it("moves ownership across a crossfade (§62-67)", () => {
    const track = loadFixture("real-track-1.trackmodel.json");
    const style = showStyleSchema.parse(BUILT_IN_STYLES.club);
    const planB = planShow(track, style);
    // A genuinely different plan for deck A (the outgoing track): its cues
    // are half intensity, so crossfade checks can tell the sides apart.
    const planA = { ...planB, trackId: "old", cues: planB.cues.map((c) => ({ ...c, intensity: Math.min(1, c.intensity * 0.5) })) };
    const beat = 120;
    const inWindow = (cues: typeof planB.cues): typeof planB.cues => cues.filter((c) => beat >= c.startBeat && beat < c.startBeat + c.durationBeats);

    // Precondition of this scenario: the fixture plan has cues at beat 120,
    // so an empty window would fail here instead of vacuously passing below.
    expect(inWindow(planB.cues).length).toBeGreaterThan(0);

    const at = (xa: number, xb: number): MixResult => mixDown(
      { state: makeDeck({ deckId: 1, channelFader: 1, crossfader: xa, track: { id: "old", sourceIds: {} } }), beat, cues: inWindow(planA.cues), impactStrength: 0.5 },
      { state: makeDeck({ deckId: 2, channelFader: 1, crossfader: xb, track: { id: "real-track-1", sourceIds: {} } }), beat, cues: inWindow(planB.cues), impactStrength: 0.9 },
    );

    // A full left: A owns, B silent. Full right: B owns with scaled cues.
    expect(at(1, 0).owner).toBe("a");
    const right = at(0, 1);
    expect(right.owner).toBe("b");
    expect(right.cues.length).toBeGreaterThan(0);
    // The survivors are exactly B's in-window cues (types and order), each
    // scaled by B's weight — nothing of A's leaks in.
    const bWindow = inWindow(planB.cues);

    expect(right.cues.map((c) => c.type)).toEqual(bWindow.map((c) => c.type));

    const w = right.weights.b;

    expect(right.cues.every((c, i) => Math.abs(c.intensity - Math.min(1, bWindow[i]!.intensity * w)) < 1e-9)).toBe(true);
    // Rendered mixed cues light the rig (section-look targets PRIMARY → left).
    const mixedPlan = { ...planB, cues: right.cues };
    const frames = renderFrame(mixedPlan, beat, [groupedFixture("left", 0, ["PRIMARY"]), groupedFixture("right", 1, ["SECONDARY"])]);
    expect([...frames.get("left")!].some((v) => v > 0)).toBe(true);
  });
});
