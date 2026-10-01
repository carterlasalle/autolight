// T-RBL-01 / T-RBL-02 / T-RBL-06 through the service: DS-15 reader modes, the
// typed queries the IPC layer exposes, the cross-check Diagnostics reports, and
// the change events the watcher feeds (spec 4.1, §5, §141).
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LibraryService, type LibraryChangeEvent } from "./service.js";
import type { SidecarRun, SidecarRunner } from "./sidecar.js";
import { readFixturePayload, writeFixtureDb, type FixtureSummary } from "./test-fixtures.js";
import type { NativeWatch, WatchedFile } from "./watch.js";

const created: string[] = [];

interface Fixture {
  root: string;
  dbPath: string;
  sharePath: string;
  summary: FixtureSummary;
}

function fixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "autolight-rbl-service-"));
  created.push(root);
  const dbPath = join(root, "master.db");
  const sharePath = join(root, "share");
  const summary = writeFixtureDb({ dbPath, sharePath, audioDir: join(root, "audio") });
  return { root, dbPath, sharePath, summary };
}

function runnerReturning(payload: unknown, code = 0): SidecarRunner {
  return () => Promise.resolve({ code, stdout: JSON.stringify(payload), stderr: "" } satisfies SidecarRun);
}

class StubNativeWatch implements NativeWatch {
  private onEvent: ((path: string) => void) | undefined;
  started: WatchedFile[] = [];

  start(files: readonly WatchedFile[], onEvent: (path: string) => void): Promise<void> {
    this.started = [...files];
    this.onEvent = onEvent;
    return Promise.resolve();
  }

  stop(): Promise<void> {
    return Promise.resolve();
  }

  fire(path: string): void {
    this.onEvent?.(path);
  }
}

afterEach(() => {
  while (created.length > 0) rmSync(created.pop() as string, { recursive: true, force: true });
});

describe("library service", () => {
  it("answers the typed queries over the TypeScript reader", async () => {
    const { dbPath, sharePath, summary } = fixture();
    const service = await LibraryService.open({ dbPath, sharePath, mode: "rekordbox-connect" });
    try {
      expect(service.reader).toBe("rekordbox-connect");
      expect(service.tracks({ limit: 2, offset: 0 }).rows.map((track) => track.rekordboxId)).toEqual(["101", "102"]);
      expect(service.tracks({ limit: 2, offset: 0 }).total).toBe(summary.counts.tracks);
      expect(service.tracks({ search: "aurora" }).rows.map((track) => track.title)).toEqual(["Aurora"]);

      const track = service.track("101");
      expect(track?.artist).toBe("Nova");
      expect(track?.album).toBe("First Light");
      expect(track?.genre).toBe("Techno");
      expect(track?.key).toBe("8A");
      expect(track?.color).toBe("Red");
      expect(track?.bpm).toBe(128);
      expect(track?.durationSeconds).toBe(300);
      expect(track?.rating).toBe(204);
      expect(track?.comments).toBe("peak time");
      expect(track?.dateAdded).toBe("2026-01-05 10:00:00.000 +00:00");
      expect(track?.fileSize).toBe(9000000);
      expect(track?.sampleRate).toBe(44100);
      expect(track?.bitRate).toBe(320);
      expect(track?.raw["ID"]).toBe("101");

      expect(service.playlists().map((playlist) => `${playlist.id}:${playlist.kind}`)).toEqual([
        "p1:playlist",
        "f1:folder",
        "p2:playlist",
      ]);
      expect(service.playlistTracks("p1").map((entry) => entry.rekordboxId)).toEqual(["101", "102"]);

      const history = service.history();
      expect(history).toHaveLength(1);
      expect(history[0]?.trackCount).toBe(3);
      expect(service.historyTracks("h1").map((entry) => entry.rekordboxId)).toEqual(["101", "103", "101"]);

      const diagnostics = service.diagnostics();
      expect(diagnostics.mode).toBe("rekordbox-connect");
      expect(diagnostics.driver).toBe("node:sqlite");
      expect(diagnostics.dbVersion).toBe("6000");
      expect(diagnostics.counts).toEqual(summary.counts);
      expect(diagnostics.anlz).toEqual({ ok: 1, partial: 1, missing: 2, audioMissing: 1 });
      expect(diagnostics.watcher.watchedFiles).toBe(0);
    } finally {
      await service.close();
    }
  });

  it("cross-checks counts, playlist membership and paths against the sidecar", async () => {
    const { dbPath, sharePath } = fixture();
    const payload = readFixturePayload(dbPath);
    const service = await LibraryService.open({
      dbPath,
      sharePath,
      encrypted: false,
      sidecar: { run: runnerReturning(payload) },
    });
    try {
      const agreement = await service.runCrossCheck();
      expect(agreement.status).toBe("agree");
      expect(agreement.mismatches).toEqual([]);
      expect(agreement.ts).toEqual(payload.counts);
      expect(agreement.py).toEqual(payload.counts);
      expect(service.diagnostics().crossCheck.status).toBe("agree");

      const disagreeing = await LibraryService.open({
        dbPath,
        sharePath,
        encrypted: false,
        sidecar: {
          run: runnerReturning({
            ...payload,
            counts: { ...payload.counts, tracks: 99 },
            tracks: [],
            playlists: [{ ID: "p9", Name: "Ghost" }],
            songPlaylists: [],
          }),
        },
      });
      try {
        const mismatch = await disagreeing.runCrossCheck();
        expect(mismatch.status).toBe("disagree");
        expect(mismatch.mismatches).toContain("tracks: ts=4 py=99");
        expect(mismatch.mismatches.some((entry) => entry.includes("p9"))).toBe(true);
      } finally {
        await disagreeing.close();
      }
    } finally {
      await service.close();
    }
  });

  it("reports an unavailable cross-check instead of failing the library", async () => {
    const { dbPath, sharePath } = fixture();
    const service = await LibraryService.open({
      dbPath,
      sharePath,
      encrypted: false,
      sidecar: { run: runnerReturning({ ok: false, error: "no interpreter" }, 1) },
    });
    try {
      const result = await service.runCrossCheck();
      expect(result.status).toBe("unavailable");
      expect(result.note).toContain("no interpreter");
      expect(service.tracks().rows).toHaveLength(4);
    } finally {
      await service.close();
    }
  });

  it("falls back to the pyrekordbox reader in auto mode when the database is locked away", async () => {
    const { root, sharePath } = fixture();
    const payload = readFixturePayload(join(root, "master.db"));
    const junk = join(root, "encrypted-master.db");
    writeFileSync(junk, "not a plain sqlite file");
    const service = await LibraryService.open({
      dbPath: junk,
      sharePath,
      sidecar: { run: runnerReturning(payload) },
    });
    try {
      expect(service.reader).toBe("pyrekordbox");
      expect(service.mode).toBe("auto");
      expect(service.tracks().total).toBe(4);
      expect(service.tracks({ search: "basalt" }).rows.map((track) => track.title)).toEqual(["Basalt"]);
      expect(service.playlists()).toHaveLength(3);
      expect(service.history()[0]?.trackCount).toBe(3);
      expect(service.diagnostics().crossCheck.status).toBe("disabled");
      expect(service.track("101")?.artist).toBe("Nova");
    } finally {
      await service.close();
    }
  });

  it("refuses to invent a reader in rekordbox-connect mode", async () => {
    const { root, sharePath } = fixture();
    const junk = join(root, "junk.db");
    writeFileSync(junk, "not a database");
    await expect(LibraryService.open({ dbPath: junk, sharePath, mode: "rekordbox-connect" })).rejects.toMatchObject({
      code: "not-a-database",
    });
  });

  it("watches the database, the WAL and each track's files, and reports what changed", async () => {
    vi.useFakeTimers();
    const { dbPath, sharePath } = fixture();
    const native = new StubNativeWatch();
    const service = await LibraryService.open({
      dbPath,
      sharePath,
      mode: "rekordbox-connect",
      watch: { engine: "auto", native, debounceMs: 0, pollMs: 60_000 },
    });
    try {
      const files = service.watchTracks(service.tracks().rows);
      expect(files.filter((file) => file.kind === "db")).toHaveLength(1);
      expect(files.filter((file) => file.kind === "wal")).toHaveLength(1);
      expect(files.filter((file) => file.kind === "anlz").length).toBeGreaterThanOrEqual(3);
      expect(files.filter((file) => file.kind === "audio")).toHaveLength(4);

      const events: LibraryChangeEvent[] = [];
      service.onChanged((event) => events.push(event));
      await service.startWatching();
      expect(native.started).toHaveLength(files.length);

      const db = new DatabaseSync(dbPath);
      try {
        db.prepare(
          `INSERT INTO djmdContent (ID, FolderPath, Title, ArtistID, BPM, Length) VALUES ('105', '/audio/105.mp3', 'Ember', 'a1', 140, 240)`,
        ).run();
      } finally {
        db.close();
      }
      native.fire(dbPath);
      // The debounce edge is a timer, so the fake clock drives it.
      vi.advanceTimersByTime(1);
      expect(events).toHaveLength(1);
      expect(events[0]?.diff?.added).toEqual(["105"]);
      expect(events[0]?.invalidated).toEqual(["identity", "row"]);
      expect(service.diagnostics().watcher).toEqual({ engine: "auto", missedChanges: 0, watchedFiles: files.length });
    } finally {
      await service.close();
      vi.useRealTimers();
    }
  });
});
