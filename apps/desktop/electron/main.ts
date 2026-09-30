import { join } from "node:path";
import { app, BrowserWindow } from "electron";
import { createIpc } from "./ipc.js";
import { startAxLoop, startProlink } from "./show-service.js";

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
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    ...(process.platform !== "darwin"
      ? { titleBarOverlay: { height: 44 } }
      : {}),
    backgroundColor: "#111318",
    webPreferences: { preload: join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false },
  });
  // Dev: Vite server; prod: Vite build output (scripts/build-main.mjs builds
  // main/preload only — renderer is Vite's dist/renderer).
  if (process.env["AUTOLIGHT_RENDERER_URL"]) {
    await win.loadURL(process.env["AUTOLIGHT_RENDERER_URL"]);
  } else {
    await win.loadFile(join(__dirname, "..", "renderer", "index.html"));
  }
  createIpc();
  startAxLoop();
  startProlink();
}
void boot();
