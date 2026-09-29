import { app, BrowserWindow } from "electron";
import { createIpc } from "./ipc.js";

// Startup sequence (§132): DB → show worker → Govee → DJ adapter →
// library watcher → analysis worker → venue → tracks → plans → arm → READY.
export type StartupStage =
  | "db" | "show-worker" | "govee" | "dj-adapter" | "library"
  | "analysis" | "venue" | "tracks" | "plans" | "arm" | "ready";

export const STARTUP_ORDER: StartupStage[] = [
  "db", "show-worker", "govee", "dj-adapter", "library",
  "analysis", "venue", "tracks", "plans", "arm", "ready",
];

export function nextStage(done: StartupStage[]): StartupStage | null {
  return STARTUP_ORDER.find((s) => !done.includes(s)) ?? null;
}

// Graceful shutdown (§133): freeze UI → ending look → disarm → adapters →
// analysis → flush → workers → exit.
export const SHUTDOWN_ORDER = [
  "freeze-ui", "ending-look", "disarm", "dj-adapters",
  "analysis", "flush-db", "workers", "exit",
] as const;

export async function boot(): Promise<void> {
  await app.whenReady();
  const win = new BrowserWindow({ width: 1600, height: 900 });
  void win;
  createIpc();
}
void boot();
