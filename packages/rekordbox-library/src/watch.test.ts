// P-141-watch: library change detection and selective invalidation with temp
// files (T-RBL-06; F-RBL-10). Covers both engines, the missed-change counter of
// the combined mode, and the column classes that decide what is invalidated.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  diffLibraryRows,
  invalidationForDiff,
  invalidationForFiles,
  LibraryWatcher,
  type LibraryRowSnapshot,
  type NativeWatch,
  type WatchChange,
  type WatchedFile,
} from "./watch.js";

const created: string[] = [];
// Long enough that a manual sweep is the only thing that runs during a test.
const IDLE_POLL_MS = 60_000;

function tempDir(): string {
  const root = mkdtempSync(join(tmpdir(), "autolight-rbl-watch-"));
  created.push(root);
  return root;
}

afterEach(() => {
  vi.useRealTimers();
  while (created.length > 0) rmSync(created.pop() as string, { recursive: true, force: true });
});

function row(rekordboxId: string, columns: Record<string, unknown>): LibraryRowSnapshot {
  return { rekordboxId, columns };
}

class RecordingNativeWatch implements NativeWatch {
  started: WatchedFile[] = [];
  stopped = false;
  private onEvent: ((path: string) => void) | undefined;

  start(files: readonly WatchedFile[], onEvent: (path: string) => void): Promise<void> {
    this.started = [...files];
    this.onEvent = onEvent;
    return Promise.resolve();
  }

  stop(): Promise<void> {
    this.stopped = true;
    return Promise.resolve();
  }

  fire(path: string): void {
    this.onEvent?.(path);
  }
}

describe("library watcher", () => {
  it("detects a polled change and names the artifacts it invalidates", () => {
    const dir = tempDir();
    const dbPath = join(dir, "master.db");
    const anlzPath = join(dir, "ANLZ0000.EXT");
    const audioPath = join(dir, "track.mp3");
    writeFileSync(dbPath, "db");
    writeFileSync(anlzPath, "ext");
    writeFileSync(audioPath, "audio");

    const watcher = new LibraryWatcher({
      engine: "polling",
      files: [
        { path: dbPath, kind: "db" },
        { path: `${dbPath}-wal`, kind: "wal" },
        { path: anlzPath, kind: "anlz", trackId: "101" },
        { path: audioPath, kind: "audio", trackId: "101" },
      ],
    });
    const changes: WatchChange[] = [];
    watcher.on((change) => changes.push(change));

    expect(watcher.sweep()).toBeUndefined();
    writeFileSync(anlzPath, "ext-updated");
    const anlzChange = watcher.sweep();
    expect(anlzChange?.files).toEqual([{ path: anlzPath, kind: "anlz", trackId: "101" }]);
    expect(anlzChange?.invalidated).toEqual(["model", "native-analysis", "plan", "row"]);

    writeFileSync(audioPath, "audio-updated-longer");
    const audioChange = watcher.sweep();
    expect(audioChange?.invalidated).toEqual(["audio-derived", "model", "native-analysis", "plan", "row"]);
    expect(changes).toHaveLength(2);
  });

  it("counts changes the OS events missed in combined mode", async () => {
    const dir = tempDir();
    const audioPath = join(dir, "track.mp3");
    writeFileSync(audioPath, "audio");
    const native = new RecordingNativeWatch();
    const watcher = new LibraryWatcher({
      engine: "auto",
      files: [{ path: audioPath, kind: "audio", trackId: "101" }],
      native,
      pollMs: IDLE_POLL_MS,
    });
    await watcher.start();
    try {
      expect(native.started).toHaveLength(1);
      writeFileSync(audioPath, "audio-changed");
      const change = watcher.sweep();
      expect(change?.source).toBe("poll");
      expect(watcher.missedChanges()).toBe(1);

      // A sweep over unchanged files adds nothing.
      expect(watcher.sweep()).toBeUndefined();
      expect(watcher.missedChanges()).toBe(1);
    } finally {
      await watcher.stop();
    }
    expect(native.stopped).toBe(true);
  });

  it("does not count a change the events already reported", async () => {
    vi.useFakeTimers();
    const dir = tempDir();
    const audioPath = join(dir, "track.mp3");
    writeFileSync(audioPath, "audio");
    const native = new RecordingNativeWatch();
    const watcher = new LibraryWatcher({
      engine: "auto",
      files: [{ path: audioPath, kind: "audio", trackId: "101" }],
      native,
      debounceMs: 5,
      pollMs: IDLE_POLL_MS,
    });
    const events: WatchChange[] = [];
    watcher.on((change) => events.push(change));
    await watcher.start();
    try {
      writeFileSync(audioPath, "audio-changed");
      native.fire(audioPath);
      // The debounce edge is a timer, so the fake clock drives it.
      vi.advanceTimersByTime(10);
      expect(events.map((event) => event.source)).toEqual(["native"]);

      writeFileSync(audioPath, "audio-changed-twice-longer");
      watcher.sweep();
      expect(watcher.missedChanges()).toBe(0);
    } finally {
      await watcher.stop();
    }
  });

  it("reports real OS events for a temp file", async () => {
    const dir = tempDir();
    const audioPath = join(dir, "track.mp3");
    writeFileSync(audioPath, "audio");
    const watcher = new LibraryWatcher({
      engine: "native-events",
      files: [{ path: audioPath, kind: "audio", trackId: "101" }],
      debounceMs: 5,
    });
    const seen: WatchChange[] = [];
    watcher.on((change) => seen.push(change));
    await watcher.start();
    try {
      // kqueue (macOS) does not deliver events for writes that land in the same
      // tick the watch was registered, so the test keeps writing until the
      // platform watcher is live; the change itself is the awaited condition.
      let probes = 0;
      await vi.waitFor(
        () => {
          writeFileSync(audioPath, `audio-changed-${probes++}`);
          expect(seen.length).toBeGreaterThan(0);
        },
        { timeout: 4000, interval: 25 },
      );
      expect(seen.at(-1)?.files[0]?.path).toBe(audioPath);
      expect(seen.at(-1)?.invalidated).toContain("audio-derived");
    } finally {
      await watcher.stop();
    }
  });

  it("invalidates only what a column change touches", () => {
    const before = [row("1", { Title: "Aurora", AnalysisDataPath: "/a/ANLZ0000.DAT", FolderPath: "/m/a.mp3", BPM: 128 })];
    const titleOnly = diffLibraryRows(before, [row("1", { Title: "Aurora (edit)", AnalysisDataPath: "/a/ANLZ0000.DAT", FolderPath: "/m/a.mp3", BPM: 128 })]);
    expect(titleOnly.changed).toEqual([{ rekordboxId: "1", columns: ["Title"] }]);
    expect(invalidationForDiff(titleOnly)).toEqual(["row"]);

    const gridChanged = diffLibraryRows(before, [row("1", { Title: "Aurora", AnalysisDataPath: "/a/ANLZ0000.DAT", FolderPath: "/m/a.mp3", BPM: 130 })]);
    expect(invalidationForDiff(gridChanged)).toEqual(["model", "native-analysis", "plan", "row"]);

    const moved = diffLibraryRows(before, [row("1", { Title: "Aurora", AnalysisDataPath: "/a/ANLZ0000.DAT", FolderPath: "/other/a.mp3", BPM: 128 })]);
    expect(invalidationForDiff(moved)).toEqual(["identity", "row"]);
  });

  it("reports added and removed rows as identity changes", () => {
    const diff = diffLibraryRows([row("1", { Title: "A" })], [row("2", { Title: "B" })]);
    expect(diff.added).toEqual(["2"]);
    expect(diff.removed).toEqual(["1"]);
    expect(invalidationForDiff(diff)).toEqual(["identity", "row"]);
  });

  it("invalidates nothing but the row cache for database and WAL edges", () => {
    expect(invalidationForFiles([{ path: "/m/master.db", kind: "db" }])).toEqual(["row"]);
    expect(invalidationForFiles([{ path: "/m/master.db-wal", kind: "wal" }])).toEqual(["row"]);
    expect(invalidationForFiles([])).toEqual([]);
  });
});
