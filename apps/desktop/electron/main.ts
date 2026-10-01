import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { app, BrowserWindow, session, type WebContents } from "electron";
import { createIpc } from "./ipc.js";
import {
  createShowService,
  getShowService,
  startAxLoop,
  startProlink,
  quitApp,
  setShowAcceptingUi,
  applyCrashPolicy,
  restartShowHost,
  runShutdown,
  crashRecordPath,
} from "./show-service.js";
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

// T-SEC-03 hardening surface. Returned as data so the checklist test
// (`electron/security.test.ts`) can assert every setting without Electron
// running; `createWindow()` must consume every field or the test goes red.
export interface SecuritySettings {
  webPreferences: {
    preload: string;
    contextIsolation: boolean;
    sandbox: boolean;
    nodeIntegration: false;
    webSecurity: boolean;
  };
  // null = forbidden entirely; a non-empty list = exact prefixes allowed.
  csp: string;
  allowedNavigation: string[];
  allowNewWindow: boolean;
  permissions: {
    audioCaptureOrigins: string[];
    midiOrigins: string[];
  };
}

export function securitySettings(preloadPath: string): SecuritySettings {
  return {
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
    // Strict CSP: local files and fonts only. No remote scripts, no eval
    // (no 'unsafe-eval' anywhere; no 'unsafe-inline' on script-src).
    csp: [
      "default-src 'none'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: file:",
      "font-src 'self' data: file:",
      "connect-src 'self' ws://localhost:5173 http://localhost:5173",
      "media-src 'self' blob: file:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ].join("; "),
    // file:// renderer plus the Vite dev server in dev. Nothing else.
    allowedNavigation: ["file://", "http://localhost:5173"],
    allowNewWindow: false,
    // Mic/audio-capture granted to the app windows only; MIDI where used
    // (FLX4 WebMIDI fallback runs in the renderer); everything else denied.
    permissions: {
      audioCaptureOrigins: ["file://", "http://localhost:5173"],
      midiOrigins: ["file://", "http://localhost:5173"],
    },
  };
}

function applySessionHardening(): void {
  const ses = session.defaultSession;
  const settings = securitySettings("");
  // CSP injected on response headers so a missing <meta> in the renderer
  // build can never silently leave the window unprotected. Inject only on
  // frame documents; cancel remote scripts and workers at the network
  // layer so a compromised CDN or worker import can never execute.
  ses.webRequest.onHeadersReceived((details, callback) => {
    if (details.resourceType !== "mainFrame" && details.resourceType !== "subFrame") {
      callback({});
      return;
    }
    const headers = { ...(details.responseHeaders ?? {}) };
    headers["Content-Security-Policy"] = [settings.csp];
    callback({ responseHeaders: headers });
  });
  // Navigation guard: only the app's own origins may navigate top-level.
  // Script and worker fetches from anywhere else are cancelled here too,
  // so a remote <script> or worker import can never execute even before
  // the CSP header lands.
  ses.webRequest.onBeforeRequest((details, callback) => {
    if (details.resourceType === "mainFrame" || details.resourceType === "subFrame") {
      const allowed =
        details.url.startsWith("file://") ||
        details.url.startsWith("http://localhost:5173") ||
        details.url.startsWith("devtools://");
      callback(allowed ? {} : { cancel: true });
      return;
    }
    if (details.resourceType === "script") {
      const local =
        details.url.startsWith("file://") ||
        details.url.startsWith("http://localhost:5173");
      callback(local ? {} : { cancel: true });
      return;
    }
    callback({});
  });
  // setPermissionRequestHandler + setPermissionCheckHandler: media device
  // enumeration consults the check handler, not only the request handler,
  // so both are installed. Grant media ("media" + "audio-capture") only to
  // the audio window and midi/midiSysex only to audio + main windows;
  // everything else denied.
  const decidePermission = (
    webContents: WebContents | null,
    permission: string,
  ): boolean => {
    const url = webContents?.getURL() ?? "";
    const local =
      url.startsWith("file://") || url.startsWith("http://localhost:5173");
    if (!local) return false;
    if (permission === "media") {
      return isAudioWindow(url);
    }
    if (permission === "midi" || permission === "midiSysex") {
      return true;
    }
    return false;
  };
  ses.setPermissionRequestHandler(
    (webContents, permission, callback) => {
      callback(decidePermission(webContents, permission));
    },
  );
  ses.setPermissionCheckHandler(
    (webContents, permission) => decidePermission(webContents, permission),
  );
}

// T-SEC-03: the audio window is the hidden DSP window (DS-14). Until it
// exists, mic/audio-capture is denied everywhere; creating it adds its URL
// here (file:// or the dev server origin), never a remote origin.
const audioWindowUrls = new Set<string>();

export function registerAudioWindow(url: string): void {
  audioWindowUrls.add(url);
}

export function isAudioWindow(url: string): boolean {
  return audioWindowUrls.has(url);
}

export async function boot(): Promise<void> {
  await app.whenReady();
  // T-ARC-02: handlers register before the window exists so the renderer's
  // first requests never race registration.
  createIpc();
  applySessionHardening();
  const settings = securitySettings(join(__dirname, "preload.cjs"));
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
    webPreferences: {
      preload: settings.webPreferences.preload,
      contextIsolation: settings.webPreferences.contextIsolation,
      sandbox: settings.webPreferences.sandbox,
      nodeIntegration: settings.webPreferences.nodeIntegration,
      webSecurity: settings.webPreferences.webSecurity,
    },
  });
  // New-window guard: deny every popup; external links must go through an
  // explicit shell.openExternal intent (none exists yet, so deny all).
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  // Navigation guard: belt over the session-level suspenders. Read the URL
  // off the event object; positional args after details are deprecated.
  win.webContents.on("will-navigate", (nav) => {
    const url = nav.url;
    if (
      !settings.allowedNavigation.some((prefix) => url.startsWith(prefix)) &&
      !url.startsWith("devtools://")
    ) {
      nav.preventDefault();
    }
  });
  // Dev: Vite server; prod: Vite build output (scripts/build-main.mjs builds
  // main/preload only — renderer is Vite's dist/renderer).
  if (process.env["AUTOLIGHT_RENDERER_URL"]) {
    await win.loadURL(process.env["AUTOLIGHT_RENDERER_URL"]);
  } else {
    await win.loadFile(join(__dirname, "..", "renderer", "index.html"));
  }
  createShowService();
  startAxLoop();
  startProlink();
  // Graceful shutdown (§133): before-quit and window close both run the
  // SHUTDOWN_ORDER steps with per-step timeouts, then quitApp exits.
  const runGracefulShutdown = (): Promise<void> => {
    markShuttingDown();
    return runShutdown({
      timeoutMs: 2000,
      onStep: (step, ms) => recordShutdownStep(step, ms),
    });
  };
  app.on("before-quit", () => {
    void runGracefulShutdown();
  });
  win.on("close", (event) => {
    if (shuttingDown()) return;
    event.preventDefault();
    void runGracefulShutdown().finally(() => quitApp());
  });
  // Crash policy: an uncaught exception in main writes a crash record,
  // sends the safe look, and restarts the show host.
  process.on("uncaughtException", (err) => {
    const record = crashRecordPath();
    try {
      writeFileSync(record, JSON.stringify({
        at: new Date().toISOString(),
        pid: process.pid,
        versions: { electron: process.versions.electron, node: process.versions.node },
        error: String(err?.stack ?? err),
      }));
    } catch { /* crash path must never throw */ }
    applyCrashPolicy({ holdMs: 2000 });
    restartShowHost();
  });
}

let shuttingDownNow = false;
function shuttingDown(): boolean {
  return shuttingDownNow;
}

function recordShutdownStep(step: string, ms: number): void {
  try {
    getShowService().recorder.record("shutdown/step", { step, ms });
  } catch { /* never block teardown on logging */ }
}
export function markShuttingDown(): void {
  shuttingDownNow = true;
  setShowAcceptingUi(false);
}

void boot();
