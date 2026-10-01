import { existsSync, statSync, watch } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ServiceTracker, messageOf, type Service, type ServiceStatus } from "./base.js";

// library-service (04-target-architecture section 1): the single owner of the
// Rekordbox and Serato library roots, read-only, plus the change watchers
// (DS-15). Reader adapters do the parsing; this service only probes roots,
// watches them and reports what is actually readable.

export type LibraryProvider = "rekordbox" | "serato";

export interface LibraryRoot {
  provider: LibraryProvider;
  path: string;
  readable: boolean;
}

export interface LibraryChange {
  provider: LibraryProvider;
  root: string;
  file: string;
  atMs: number;
}

export interface LibraryWatcher {
  close(): void;
  on(event: "error", listener: (err: Error) => void): void;
}

export interface LibraryServiceOptions {
  roots?: { provider: LibraryProvider; path: string }[];
  homeDir?: string;
  platform?: NodeJS.Platform;
  debounceMs?: number;
  // Watch seam: production uses fs.watch; tests drive their own watcher so
  // the debounce and batching logic does not depend on FSEvents latency.
  watchRoot?: (root: string, onEvent: (file: string) => void) => LibraryWatcher;
}

// Default roots per provider: rekordbox keeps its library under
// Pioneer/rekordbox (macOS puts it under ~/Library), Serato under
// ~/Music/_Serato_. Candidates are probed, never assumed to exist.
export function defaultLibraryRoots(
  home = homedir(),
  platform = process.platform,
): { provider: LibraryProvider; path: string }[] {
  const rekordbox = platform === "darwin"
    ? join(home, "Library", "Pioneer", "rekordbox")
    : join(home, "Pioneer", "rekordbox");
  return [
    { provider: "rekordbox", path: rekordbox },
    { provider: "serato", path: join(home, "Music", "_Serato_") },
  ];
}

export class LibraryService implements Service {
  readonly name = "library-service";
  private readonly tracker = new ServiceTracker("library-service");
  private watchers: LibraryWatcher[] = [];
  private roots: LibraryRoot[] = [];
  private pending: LibraryChange[] = [];
  private debounce: NodeJS.Timeout | null = null;
  private readonly listeners = new Set<(changes: LibraryChange[]) => void>();
  private readonly opts: LibraryServiceOptions;

  constructor(opts: LibraryServiceOptions = {}) {
    this.opts = opts;
  }

  start(): ServiceStatus {
    if (this.watchers.length > 0) return this.status();
    const candidates = this.opts.roots ?? defaultLibraryRoots(this.opts.homeDir, this.opts.platform);
    this.roots = candidates.map((candidate) => ({
      provider: candidate.provider,
      path: candidate.path,
      readable: isReadableDir(candidate.path),
    }));
    const watchRoot = this.opts.watchRoot ?? defaultWatchRoot;
    for (const root of this.roots) {
      if (!root.readable) continue;
      try {
        const watcher = watchRoot(root.path, (file) => { this.enqueue(root, file); });
        watcher.on("error", (err) => {
          this.tracker.set("degraded", `watch failed on ${root.path}: ${messageOf(err)}`);
        });
        this.watchers.push(watcher);
      } catch (err) {
        this.tracker.set("degraded", `watch failed on ${root.path}: ${messageOf(err)}`);
      }
    }
    this.tracker.setCounter("roots", this.roots.length);
    this.tracker.setCounter("watchers", this.watchers.length);
    const readable = this.roots.filter((r) => r.readable);
    if (readable.length === 0) {
      this.tracker.set("degraded", "no readable library root (rekordbox or serato not installed, or permission denied)");
    } else {
      this.tracker.set("running", readable.map((r) => `${r.provider}: ${r.path}`).join(", "));
    }
    return this.status();
  }

  stop(): ServiceStatus {
    for (const watcher of this.watchers) watcher.close();
    this.watchers = [];
    if (this.debounce !== null) clearTimeout(this.debounce);
    this.debounce = null;
    this.tracker.set("stopped");
    return this.status();
  }

  status(): ServiceStatus {
    this.tracker.setCounter("roots", this.roots.length);
    this.tracker.setCounter("watchers", this.watchers.length);
    this.tracker.setCounter("pendingChanges", this.pending.length);
    return this.tracker.status();
  }

  libraryRoots(): LibraryRoot[] {
    return this.roots.map((r) => ({ ...r }));
  }

  onChanges(listener: (changes: LibraryChange[]) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // Coalesce filesystem bursts (rekordbox writes in place): one event per
  // debounce window, carrying every path seen.
  private enqueue(root: LibraryRoot, file: string): void {
    this.pending.push({ provider: root.provider, root: root.path, file, atMs: Date.now() });
    this.tracker.count("events");
    if (this.debounce !== null) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      const batch = this.pending;
      this.pending = [];
      this.debounce = null;
      this.tracker.count("batches");
      for (const listener of this.listeners) listener(batch);
    }, this.opts.debounceMs ?? 150);
  }
}

function isReadableDir(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

// Production watcher: recursive fs.watch with an explicit callback wrapper
// (fs.watch supplies eventType and filename), adapted to the port type so the
// two overloads of FSWatcher.on do not leak into the service.
function defaultWatchRoot(root: string, onEvent: (file: string) => void): LibraryWatcher {
  const watcher = watch(root, { recursive: true }, (eventType, filename) => {
    onEvent(filename === null ? eventType : filename);
  });
  return {
    close: () => { watcher.close(); },
    on: (event, listener) => { watcher.on(event, listener); },
  };
}

let instance: LibraryService | null = null;

export function getLibraryService(opts: LibraryServiceOptions = {}): LibraryService {
  instance ??= new LibraryService(opts);
  return instance;
}
