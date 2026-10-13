import { mkdtempSync, mkdirSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi, afterEach } from "vitest";
import { LiveShowBridge, resetLiveShowBridgeForTest } from "./live-show-bridge.js";

const REAL_ANLZ_DIR = "/Users/rocket/Library/Pioneer/rekordbox/share/PIONEER/USBANLZ/135/fb47d-24bc-49c5-b5e7-ce275ed46465";

const REAL_ARTIFACT = "/Users/rocket/.autolight/analysis-cache/39ec10359514c496a6164306.trackmodel.json";

describe("live show bridge", () => {
  const tmpDirs: string[] = [];
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

  it("analyzes on first sight then coasts from cache without re-analyzing", async () => {
    // Fixture share: one bucket with one ANLZ set (copied metadata only).
    const share = mkdtempSync(join(tmpdir(), "bridge-share-"));
    tmpDirs.push(share);
    const bucket = join(share, "135");
    const trackDir = join(bucket, "fb47d-24bc-49c5-b5e7-ce275ed46465");
    mkdirSync(trackDir, { recursive: true });
    cpSync(join(REAL_ANLZ_DIR, "ANLZ0000.DAT"), join(trackDir, "ANLZ0000.DAT"));

    const artifactDir = mkdtempSync(join(tmpdir(), "bridge-artifact-"));
    tmpDirs.push(artifactDir);
    const artifactPath = join(artifactDir, "live-deck1.trackmodel.json");
    cpSync(REAL_ARTIFACT, artifactPath);

    const analyze = vi.fn(async () => artifactPath);
    const bridge = new LiveShowBridge({ shareDir: share, analyze });

    const first = await bridge.resolveDeck(1, 10, true, null);
    expect(analyze).toHaveBeenCalledTimes(1);
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

  it("failed analysis stays honest (null, no cached deck)", async () => {
    const share = mkdtempSync(join(tmpdir(), "bridge-share-"));
    tmpDirs.push(share);
    const bucket = join(share, "135");
    const trackDir = join(bucket, "fb47d-24bc-49c5-b5e7-ce275ed46465");
    mkdirSync(trackDir, { recursive: true });
    cpSync(join(REAL_ANLZ_DIR, "ANLZ0000.DAT"), join(trackDir, "ANLZ0000.DAT"));

    const analyze = vi.fn(async () => null);
    const bridge = new LiveShowBridge({ shareDir: share, analyze });
    expect(await bridge.resolveDeck(1, 10, true, null)).toBeNull();
    expect(bridge.decksSnapshot()).toEqual([]);
  });

  it("an unstarted supervisor surfaces E_SUPERVISOR_NOT_STARTED, never a silent empty", async () => {
    const { AnalysisSupervisor } = await import("./analysis-supervisor.js");
    const supervisor = new AnalysisSupervisor();
    const res = await supervisor.submit({ trackId: "t", audioPath: "", priority: "deck" });
    expect(res.ok).toBe(false);

    if (!res.ok) expect(res.error.code).toBe("E_SUPERVISOR_NOT_STARTED");
    supervisor.start();
  });
});
