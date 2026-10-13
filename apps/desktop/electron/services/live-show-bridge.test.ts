import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getLiveShowBridge, LiveShowBridge, resetLiveShowBridgeForTest } from "./live-show-bridge.js";

// Committed TrackModel fixture (the T-ANA-12 parity file): the suite is
// self-contained and runs on any machine, CI included.
const FIXTURE_TRACK_MODEL = fileURLToPath(new URL("../../../../test-fixtures/analysis/live-deck1.trackmodel.json", import.meta.url));

describe("live show bridge", () => {
  const tmpDirs: string[] = [];

  const tmp = (prefix: string): string => {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    tmpDirs.push(dir);

    return dir;
  };

  // One ANLZ bucket with one track dir per entry. `dat` is the utf16le text
  // the title heuristic extracts ("" for existence-only dirs — the bridge
  // never parses the bytes when no title is supplied).
  const makeShare = (tracks: { name: string; dat?: string }[]) => {
    const share = tmp("bridge-share-");
    const bucket = join(share, "135");
    const dirs: string[] = [];

    for (const { name, dat } of tracks) {
      const trackDir = join(bucket, name);
      mkdirSync(trackDir, { recursive: true });
      writeFileSync(join(trackDir, "ANLZ0000.DAT"), dat ?? "", "utf16le");
      dirs.push(trackDir);
    }

    return { share, dirs };
  };

  const makeArtifact = (): string => {
    const path = join(tmp("bridge-artifact-"), "trackmodel.json");
    copyFileSync(FIXTURE_TRACK_MODEL, path);

    return path;
  };

  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    resetLiveShowBridgeForTest();
  });

  it("returns null with no analyzer and honest empty snapshot", async () => {
    const bridge = new LiveShowBridge({ shareDir: "/nonexistent-share" });
    expect(await bridge.resolveDeck(1, 10, true, null)).toBeNull();
    expect(bridge.decksSnapshot()).toEqual([]);
    expect(bridge.fixturesSnapshot()).toEqual([]);
  });

  it("analyzes the discovered ANLZ dir on first sight then coasts from cache", async () => {
    const { share, dirs } = makeShare([{ name: "track-one" }]);
    const artifactPath = makeArtifact();
    const analyze = vi.fn(async () => artifactPath);
    const bridge = new LiveShowBridge({ shareDir: share, analyze });

    const first = await bridge.resolveDeck(1, 10, true, null);
    // The discovered dir and the deck-scoped track id both reach the
    // analyzer: a wrong-dir or wrong-id association surfaces right here.
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(analyze).toHaveBeenCalledWith("", dirs[0], "live-deck1");
    expect(first?.track?.beatGrid.beats.length).toBeGreaterThan(100);
    expect(first?.plan).not.toBeNull();
    expect(first?.state.playheadSeconds).toBe(10);

    // Second sight with advanced elapsed: cache serves, analyzer not recalled.
    const second = await bridge.resolveDeck(1, 25, true, null);
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(second?.state.playheadSeconds).toBe(25);
    expect(second?.track).toBe(first?.track);

    // Unreadable poll coasts on the last good deck.
    const coast = await bridge.resolveDeck(1, null, false, null);
    expect(coast?.state.playheadSeconds).toBe(25);
  });

  it("binds separate untitled decks to separate ANLZ dirs", async () => {
    const { share, dirs } = makeShare([{ name: "track-one" }, { name: "track-two" }]);
    const artifactPath = makeArtifact();
    const seen: string[] = [];

    const analyze = vi.fn(async (_audio: string, nativeDir: string | null) => {
      seen.push(nativeDir ?? "");

      return artifactPath;
    });

    const bridge = new LiveShowBridge({ shareDir: share, analyze });

    await bridge.resolveDeck(1, 5, true, null);
    await bridge.resolveDeck(2, 7, true, null);
    expect(seen).toHaveLength(2);
    expect(new Set(seen).size).toBe(2);
    expect(dirs).toContain(seen[0]);
    expect(dirs).toContain(seen[1]);
  });

  it("retries keep their ANLZ dir when the analysis fails", async () => {
    const { share, dirs } = makeShare([{ name: "track-one" }]);
    const analyze = vi.fn(async () => null);
    const bridge = new LiveShowBridge({ shareDir: share, analyze });
    expect(await bridge.resolveDeck(1, 10, true, null)).toBeNull();
    expect(await bridge.resolveDeck(1, 12, true, null)).toBeNull();
    expect(analyze).toHaveBeenCalledTimes(2);
    expect(analyze).toHaveBeenNthCalledWith(1, "", dirs[0], "live-deck1");
    expect(analyze).toHaveBeenNthCalledWith(2, "", dirs[0], "live-deck1");
  });

  it("an analyzer rejection is an honest miss, not a rejected promise", async () => {
    const { share } = makeShare([{ name: "track-one" }]);

    const analyze = vi.fn(async () => {
      throw new Error("worker spawn failed");
    });

    const bridge = new LiveShowBridge({ shareDir: share, analyze });
    await expect(bridge.resolveDeck(1, 10, true, null)).resolves.toBeNull();
    expect(bridge.decksSnapshot()).toEqual([]);
  });

  it("concurrent first sight for one deck coalesces onto a single analysis", async () => {
    const { share } = makeShare([{ name: "track-one" }]);
    const artifactPath = makeArtifact();
    // The Promise executor runs synchronously, so `release` is assigned
    // before anything below can call it.
    let release!: () => void;

    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const analyze = vi.fn(async () => {
      await gate;

      return artifactPath;
    });

    const bridge = new LiveShowBridge({ shareDir: share, analyze });

    const pendingA = bridge.resolveDeck(1, 10, true, null);
    const pendingB = bridge.resolveDeck(1, 11, true, null);
    release();
    const [a, b] = await Promise.all([pendingA, pendingB]);
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it("title matching ignores short noisy runs and binds the real dir", async () => {
    const { share, dirs } = makeShare([
      { name: "aaa-noise", dat: "mix " },
      { name: "zzz-real", dat: "Strobe Lead" },
    ]);

    const artifactPath = makeArtifact();
    let calledDir: string | null = null;

    const analyze = vi.fn(async (_audio: string, nativeDir: string | null) => {
      calledDir = nativeDir;

      return artifactPath;
    });

    const bridge = new LiveShowBridge({ shareDir: share, analyze });

    await bridge.resolveDeck(1, 10, true, "Strobe Lead (Extended Mix)");
    const realDir = dirs.find((d) => d.endsWith("zzz-real"));
    const noiseDir = dirs.find((d) => d.endsWith("aaa-noise"));
    expect(calledDir).toBe(realDir);
    expect(calledDir).not.toBe(noiseDir);
  });

  it("late getLiveShowBridge options supply the analyzer after bare construction", async () => {
    const { share } = makeShare([{ name: "track-one" }]);
    const artifactPath = makeArtifact();
    const bare = getLiveShowBridge({ shareDir: "/nonexistent-share" });
    expect(await bare.resolveDeck(1, 10, true, null)).toBeNull();

    const late = getLiveShowBridge({ shareDir: share, analyze: async () => artifactPath });
    expect(late).toBe(bare);
    const deck = await late.resolveDeck(1, 10, true, null);
    expect(deck?.track?.beatGrid.beats.length).toBeGreaterThan(100);
  });

  it("an analyzer already wired into the singleton survives later registrations", async () => {
    const { share } = makeShare([{ name: "track-one" }]);
    const artifactPath = makeArtifact();
    // Seams (test harnesses, injected callers) install their analyzer before
    // the app's own readLiveShow re-registers on every call: the registration
    // supplies a missing analyzer, it never clobbers one already in place.
    const injected = getLiveShowBridge({ shareDir: share, analyze: async () => artifactPath });
    getLiveShowBridge({ analyze: async () => null });
    const deck = await injected.resolveDeck(1, 10, true, null);
    expect(deck).not.toBeNull();
    expect(deck?.track?.beatGrid.beats.length).toBeGreaterThan(100);
  });

  it("an unstarted supervisor surfaces E_SUPERVISOR_NOT_STARTED, never a silent empty", async () => {
    const { AnalysisSupervisor } = await import("./analysis-supervisor.js");
    const supervisor = new AnalysisSupervisor();
    const res = await supervisor.submit({ trackId: "t", audioPath: "", priority: "deck" });
    expect(res.ok).toBe(false);

    if (!res.ok) expect(res.error.code).toBe("E_SUPERVISOR_NOT_STARTED");
  });
});
