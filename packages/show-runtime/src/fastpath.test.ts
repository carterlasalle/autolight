// Track load fast path plus boundary upgrade (T-RUN-08, P-138, P-140).
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { showPlanSchema, trackModelSchema } from "@autolight/contracts";
import { MemoryAliasStore } from "@autolight/track-identity";
import { clearFastPathCache, configSnapshotHash, Store, styleHash, venueClassHash } from "@autolight/storage";
import { createDeckWorld } from "./index.js";
import { installUpgrade, loadGeneration, upgradeAtBoundary, worldWithPlan, DEFAULT_UPGRADE_BOUNDARY } from "./fastpath.js";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "test-fixtures", "analysis");
const trackModel = trackModelSchema.parse(JSON.parse(readFileSync(join(fixtureDir, "live-deck1.trackmodel.json"), "utf8")));
const showPlan = showPlanSchema.parse(JSON.parse(readFileSync(join(fixtureDir, "live-deck1.showplan.json"), "utf8")));

const created: string[] = [];
afterEach(() => {
  while (created.length > 0) rmSync(created.pop() as string, { recursive: true, force: true });
});

function seedStore(store: Store, trackId: string): {
  analyzerVersion: string; plannerVersion: string; styleHash: string; venueClass: string; configHash: string; sourceFingerprint: string;
} {
  const key = {
    analyzerVersion: trackModel.analyzerVersion,
    plannerVersion: showPlan.plannerVersion,
    styleHash: styleHash({ id: showPlan.styleId }),
    venueClass: venueClassHash(["segments"]),
    configHash: configSnapshotHash({ "runtime.fastPath.budgetMs": 100 }),
    sourceFingerprint: "fp-1",
  };
  const dir = mkdtempSync(join(tmpdir(), "autolight-run08-"));
  created.push(dir);
  const artifact = join(dir, "model.json");
  writeFileSync(artifact, JSON.stringify(trackModel));
  store.saveTrack(trackId, JSON.stringify(trackModel.identity), trackModel.durationSeconds);
  store.saveArtifact(trackId, key.analyzerVersion, artifact, key.sourceFingerprint, { configHash: key.configHash });
  store.saveShowPlan(trackId, showPlan.styleId, key.plannerVersion, showPlan.seed, JSON.stringify({ ...showPlan, trackId, styleId: showPlan.styleId }), {
    sourceFingerprint: key.sourceFingerprint,
    styleHash: key.styleHash,
    venueClass: key.venueClass,
    configHash: key.configHash,
  });
  return key;
}

/** Key shape without touching the database (for the probe load). */
function seedKey(): { analyzerVersion: string; plannerVersion: string; styleHash: string; venueClass: string; configHash: string; sourceFingerprint: string } {
  return {
    analyzerVersion: trackModel.analyzerVersion,
    plannerVersion: showPlan.plannerVersion,
    styleHash: styleHash({ id: showPlan.styleId }),
    venueClass: venueClassHash(["segments"]),
    configHash: configSnapshotHash({ "runtime.fastPath.budgetMs": 100 }),
    sourceFingerprint: "fp-1",
  };
}

const byId = (id: string): { rekordboxId: string; canonicalPath: string } | undefined =>
  id === "101" ? { rekordboxId: "101", canonicalPath: "/Music/Aurora.mp3" } : undefined;

describe("track load fast path (T-RUN-08, P-138)", () => {
  it("resolves identity and installs cached model plus plan as objects", () => {
    const store = new Store();
    const aliases = new MemoryAliasStore();
    let n = 0;
    const probeWorld = createDeckWorld(9);
    const probe = loadGeneration(
      probeWorld,
      1,
      { memoryReaderId: "101", libraryById: byId },
      { ...seedKey(), styleId: showPlan.styleId },
      { store, makeId: () => `t${++n}` },
      aliases,
    );
    const trackId = probe.resolution.trackId!;
    const key = seedStore(store, trackId);
    const world = createDeckWorld(1);
    const before = performance.now();
    const loaded = loadGeneration(
      world,
      2,
      { memoryReaderId: "101", libraryById: byId },
      { ...key, styleId: showPlan.styleId, trackId },
      { store, makeId: () => `t${++n}` },
      aliases,
    );
    expect(loaded.installed).toBe(true);
    expect(loaded.resolution.matchedStep).toBe("memory-reader-id");
    expect(typeof loaded.track).not.toBe("string");
    expect(loaded.track?.identity.id).toBe(trackModel.identity.id);
    expect(loaded.plan?.trackId).toBe(trackId);
    expect(world.plan?.trackId).toBe(trackId);
    expect(world.generation).toBe(2);
    expect(loaded.totalMs).toBeLessThan(100);
    expect(performance.now() - before).toBeLessThan(1000);
  });
  it("installs the model and compiles when the plan is missing, analyzes when nothing is cached", () => {
    const store = new Store();
    const aliases = new MemoryAliasStore();
    let n = 0;
    const probe = loadGeneration(
      createDeckWorld(9),
      1,
      { memoryReaderId: "101", libraryById: byId },
      { ...seedKey(), styleId: showPlan.styleId },
      { store, makeId: () => `t${++n}` },
      aliases,
    );
    const trackId = probe.resolution.trackId!;
    const key = seedStore(store, trackId);
    clearFastPathCache();
    store.exec("DELETE FROM show_plans");
    const world = createDeckWorld(1);
    let compiled = 0;
    const miss = loadGeneration(
      world,
      3,
      { memoryReaderId: "101", libraryById: byId },
      { ...key, styleId: showPlan.styleId, trackId },
      { store, makeId: () => `t${++n}`, compileNow: () => { compiled++; } },
      aliases,
    );
    expect(miss.track).not.toBeNull();
    expect(miss.plan).toBeNull();
    expect(miss.miss).toBe("no-plan");
    expect(compiled).toBe(1);
    let analyzed = 0;
    const empty = loadGeneration(
      createDeckWorld(2),
      4,
      { title: "Unknown", titleIndex: () => [] },
      { ...key, styleId: showPlan.styleId, trackId: "t-missing" },
      { store, makeId: () => `t${++n}`, analyzeNow: () => { analyzed++; } },
      aliases,
    );
    expect(empty.track).toBeNull();
    expect(empty.installed).toBe(false);
    expect(analyzed).toBe(1);
  });
  it("parks upgrades at the phrase boundary, never mid-phrase", () => {
    expect(DEFAULT_UPGRADE_BOUNDARY).toBe("phrase");
    const d = upgradeAtBoundary({ plan: showPlan, beat: 60, boundary: "phrase", phraseBoundaries: [32, 64, 96], sectionBoundaries: [0, 128] });
    expect(d.installAtBeat).toBe(64);
    expect(d.waitBeats).toBe(4);
    const atBoundary = upgradeAtBoundary({ plan: showPlan, beat: 64, boundary: "phrase", phraseBoundaries: [32, 64, 96], sectionBoundaries: [0, 128] });
    expect(atBoundary.waitBeats).toBe(0);
    const noFuture = upgradeAtBoundary({ plan: showPlan, beat: 200, boundary: "phrase", phraseBoundaries: [32, 64], sectionBoundaries: [] });
    expect(noFuture.installAtBeat).toBe(200);
  });
  it("installs the decided upgrade into the world on the boundary tick", () => {
    const world = worldWithPlan(1, 1, trackModel, showPlan);
    const next = { ...showPlan, seed: "next" };
    installUpgrade(world, 2, next);
    expect(world.plan?.seed).toBe("next");
    expect(world.generation).toBe(2);
  });
});
