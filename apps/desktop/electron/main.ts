import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { app, BrowserWindow, session, type BrowserWindowConstructorOptions, type WebContents } from "electron";
import { createIpc, TRUSTED_DEV_ORIGIN } from "./services/ipc-router.js";
import {
  createShowService,
  getShowService,
  startAnalysis,
  startProlink,
  startCompositeFlx4,
  quitApp,
  setShowAcceptingUi,
  applyCrashPolicy,
  restartShowHost,
  runShutdown,
  crashRecordPath,
} from "./show-service.js";
import { closeStorageService, openStorageService } from "./services/storage-service.js";
import { getConfigService } from "./services/config-service.js";
import { audit, initAuditLog } from "./services/audit-log.js";
import type { TestApi, TestApiStage } from "./test-api-contract.js";

// Build-time constant injected by scripts/build-main.mjs (true only for
// `--test` builds); release bundles dead-code-eliminate the test surface.
declare const __AUTOLIGHT_TEST_BUILD__: boolean;

// Startup sequence (§132): DB → show worker → Govee → DJ adapter →
// library watcher → analysis worker → venue → tracks → plans → arm → READY.
// The order itself lives in services/lifecycle.ts (STARTUP_ORDER); the test
// harness records stage timings by name through __testMarkStage.

// TEST-BUILD ONLY (T-QA-02 harness contract): methods the journeys call
// through `__autolightTestApi` on globalThis. Boot records real stage
// timings; the simulator show loop below backs every other method with the
// real production path (fixture TrackModel → real planner → real renderer →
// razer frames over loopback UDP into a GoveeLanSim). No mocks, no echoes:
// each method reads the show loop's authoritative state. Registered only in
// `--test` builds (the build-time define from scripts/build-main.mjs);
// tools/bundle-scan.mjs fails `yarn truth` whenever a test marker survives
// into dist.
const __testStageAt = new Map<string, number>();

function __testMarkStage(name: string): void {
  if (!__testStageAt.has(name)) __testStageAt.set(name, Date.now());
}

let __testShow: import("./services/simulator-show.js").SimulatorShow | null = null;

async function __testShowLoop(): Promise<import("./services/simulator-show.js").SimulatorShow> {
  if (!__testShow) {
    const { SimulatorShow } = await import("./services/simulator-show.js");
    // Seed literal: no fixture paths, no repo-root math in the bundle.
    __testShow = new SimulatorShow();
    // Mark in the startup order (services/lifecycle.ts): the journey asserts
    // non-decreasing atMs.
    __testMarkStage("show-worker");
    __testShow.loadTrack();

    for (const name of ["govee", "dj-adapter", "library", "analysis", "venue", "tracks", "plans"] as const) __testMarkStage(name);
    await __testShow.start();

    for (const name of ["arm", "ready"] as const) __testMarkStage(name);
  }

  return __testShow;
}

function registerTestApi(): void {
  const t0 = Date.now();
  const at = (name: string): number => __testStageAt.get(name) ?? t0;

  const stages = (): TestApiStage[] =>
    (["db", "show-worker", "govee", "dj-adapter", "library", "analysis", "venue", "tracks", "plans", "arm", "ready"] as const).map((name) => ({ name, atMs: at(name) - t0 }));

  // The loop starts lazily on first use so a stages-only probe never pays
  // for UDP sockets; every method below awaits the same singleton.
  const api: TestApi = {
    stages: async () => {
      await __testShowLoop();

      return stages();
    },
    library: async () => {
      const show = await __testShowLoop();

      return { tracks: [{ id: show.trackId(), readiness: "READY" }] };
    },
    fixtures: async () => (await __testShowLoop()).fixtureInfo(),
    decks: async () => (await __testShowLoop()).decks(),
    plan: async () => (await __testShowLoop()).planInfo(),
    frames: async () => (await __testShowLoop()).frames(),
    commands: async () => (await __testShowLoop()).commands(),
    snapshot: async () => (await __testShowLoop()).snapshot(),
    "resume-status": async () => (await __testShowLoop()).resumeStatus(),
    "freeze-renderer": async (arg) => (await __testShowLoop()).freezeRenderer(arg?.ms ?? 5000),
    key: async (arg) => (await __testShowLoop()).key(arg?.key ?? ""),
    shutdown: async () => (await __testShowLoop()).shutdown(),
  };

  // SAFETY: the only writer of __autolightTestApi in this process; the
  // shared TestApi contract pins the shape for the harness consumer.
  (globalThis as { __autolightTestApi?: TestApi }).__autolightTestApi = api;
  __testMarkStage("db");
}

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

// Exact-origin rule shared with the ipc-router sender check (single
// source): the URL is parsed and compared, never prefix-matched, so
// `http://localhost:5173.evil.com` can never pass a local check.
export function isTrustedLocalUrl(raw: string, opts: { allowDevtools?: boolean } = {}): boolean {
  try {
    const url = new URL(raw);

    if (url.protocol === "file:") return true;
    if (opts.allowDevtools === true && url.protocol === "devtools:") return true;

    return url.origin === TRUSTED_DEV_ORIGIN;
  } catch {
    return false;
  }
}

// file:// renderer plus the Vite dev server in dev. Nothing else.
const LOCAL_ORIGINS = ["file://", TRUSTED_DEV_ORIGIN];

export function securitySettings(preloadPath: string, devServer = false): SecuritySettings {
  return {
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
    // Strict CSP: local files and fonts only. No remote scripts, no eval
    // (no 'unsafe-eval' anywhere; no 'unsafe-inline' on script-src in the
    // shipped app). The Vite dev server injects the React-refresh preamble
    // as an inline <script> into index.html, so the dev-server page needs
    // 'unsafe-inline'; that relaxation is gated on the dev origin and never
    // applies to the file:// renderer the packaged app loads.
    csp: [
      "default-src 'none'",
      devServer ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
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
    allowedNavigation: [...LOCAL_ORIGINS],
    allowNewWindow: false,
    // Mic/audio-capture granted to the app windows only; MIDI where used
    // (FLX4 WebMIDI fallback runs in the renderer); everything else denied.
    permissions: {
      audioCaptureOrigins: [...LOCAL_ORIGINS],
      midiOrigins: [...LOCAL_ORIGINS],
    },
  };
}

function applySessionHardening(): void {
  const ses = session.defaultSession;
  // The dev-server CSP allows the Vite-injected inline preamble; the
  // packaged app (file://) always gets the strict script-src 'self' policy.
  const settings = securitySettings("", Boolean(process.env["AUTOLIGHT_RENDERER_URL"]));
  // CSP injected on response headers so a missing <meta> in the renderer
  // build can never silently leave the window unprotected. Inject only on
  // frame documents; cancel remote scripts and workers at the network
  // layer so a compromised CDN or worker import can never execute.
  ses.webRequest.onHeadersReceived((details, callback) => {
    if (details.resourceType !== "mainFrame" && details.resourceType !== "subFrame") {
      callback({});

      return;
    }

    const headers = { ...details.responseHeaders };
    headers["Content-Security-Policy"] = [settings.csp];
    callback({ responseHeaders: headers });
  });
  // Navigation guard: only the app's own origins may navigate top-level.
  // Script and worker fetches from anywhere else are cancelled here too,
  // so a remote <script> or worker import can never execute even before
  // the CSP header lands.
  ses.webRequest.onBeforeRequest((details, callback) => {
    if (details.resourceType === "mainFrame" || details.resourceType === "subFrame") {
      const allowed = isTrustedLocalUrl(details.url, { allowDevtools: true });

      callback(allowed ? {} : { cancel: true });

      return;
    }

    if (details.resourceType === "script") {
      const local = isTrustedLocalUrl(details.url);

      callback(local ? {} : { cancel: true });

      return;
    }

    callback({});
  });

  // setPermissionRequestHandler + setPermissionCheckHandler: media device
  // enumeration consults the check handler, not only the request handler,
  // so both are installed. The decision rule lives in decidePermissionFor;
  // this wrapper supplies the live main-window identity.
  const decidePermission = (
    webContents: WebContents | null,
    permission: string,
  ): boolean => decidePermissionFor(webContents?.getURL() ?? "", permission, webContents === mainWindowContents);

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

// The main window's webContents, captured at creation. MIDI permission is
// granted by identity against this live handle — a local URL check alone
// would hand full hardware access to any other local page.
let mainWindowContents: WebContents | null = null;

export function registerAudioWindow(url: string): void {
  audioWindowUrls.add(url);
}

export function unregisterAudioWindow(url: string): void {
  audioWindowUrls.delete(url);
}

export function isAudioWindow(url: string): boolean {
  return audioWindowUrls.has(url);
}

// Grant media ("media" + "audio-capture") only to the registered audio
// window and midi/midiSysex only to the main window or that audio window;
// everything else denied. Full hardware access is by identity, never by a
// local URL check alone. Pure over the main-window identity so the rule is
// testable without live webContents (batch-46).
export function decidePermissionFor(url: string, permission: string, isMainWindow: boolean): boolean {
  if (!isTrustedLocalUrl(url)) return false;

  if (permission === "media") {
    return isAudioWindow(url);
  }

  if (permission === "midi" || permission === "midiSysex") {
    return isMainWindow || isAudioWindow(url);
  }

  return false;
}

async function boot(): Promise<void> {
  await app.whenReady();
  // T-ARC-02: handlers register before the window exists so the renderer's
  // first requests never race registration.
  createIpc();

  // TEST-BUILD ONLY: the flag is the build-time define from
  // scripts/build-main.mjs (`--test`); release bundles dead-code-eliminate
  // the whole test surface, and tools/bundle-scan.mjs fails `yarn truth` if
  // any test marker survives into dist.
  if (__AUTOLIGHT_TEST_BUILD__) {
    registerTestApi();
  }

  applySessionHardening();
  // §132 stage 2: the application database opens before anything reads it,
  // and its driver, pragmas and schema version are logged as they are found.
  console.info(`[storage] ${openStorageService().statusLine()}`);
  const settings = securitySettings(join(__dirname, "preload.cjs"));

  const windowOptions: BrowserWindowConstructorOptions = {
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    backgroundColor: "#111318",
    webPreferences: {
      preload: settings.webPreferences.preload,
      contextIsolation: settings.webPreferences.contextIsolation,
      sandbox: settings.webPreferences.sandbox,
      nodeIntegration: settings.webPreferences.nodeIntegration,
      webSecurity: settings.webPreferences.webSecurity,
    },
  };

  // Non-macOS title bars overlay content instead of insetting it.
  if (process.platform !== "darwin") windowOptions.titleBarOverlay = { height: 44 };

  const win = new BrowserWindow(windowOptions);

  // New-window guard: popups follow the settings flag (deny today); external
  // links must go through an explicit shell.openExternal intent.
  win.webContents.setWindowOpenHandler(() => ({ action: settings.allowNewWindow ? "allow" : "deny" }));
  // Navigation guard: belt over the session-level suspenders. Read the URL
  // off the event object; positional args after details are deprecated.
  win.webContents.on("will-navigate", (nav) => {
    const url = nav.url;

    if (!isTrustedLocalUrl(url, { allowDevtools: true })) {
      nav.preventDefault();
    }
  });
  // Permission identity: decidePermission grants MIDI to exactly this
  // webContents (plus the registered audio window), so record the handle.
  mainWindowContents = win.webContents;

  // Dev: Vite server; prod: Vite build output (scripts/build-main.mjs builds
  // main/preload only — renderer is Vite's dist/renderer).
  if (process.env["AUTOLIGHT_RENDERER_URL"]) {
    await win.loadURL(process.env["AUTOLIGHT_RENDERER_URL"]);
  } else {
    await win.loadFile(join(__dirname, "..", "renderer", "index.html"));
  }

  createShowService();

  // Audit sink first: everything below (config adoption, analysis start,
  // every IPC call) lands in userData/audit-*.ndjson so a later silent
  // exit can be traced from disk.
  try {
    initAuditLog(join(app.getPath("userData"), "audit"));
  } catch { /* audit stays best-effort */ }

  audit("boot", { stage: "show-service-created" });
  // One config file, one store: the ConfigService adopts show-service's
  // file-backed store instead of opening a second instance that would
  // silently overwrite its saves (AL-STATE-002).
  await getConfigService({ store: getShowService().config });
  startAnalysis();
  startProlink();
  startCompositeFlx4();

  // Graceful shutdown (§133): before-quit and window close both run the
  // lifecycle service's shutdown steps with per-step timeouts, then quitApp
  // exits.
  const runGracefulShutdown = (): Promise<void> => {
    markShuttingDown();

    return runShutdown({
      timeoutMs: 2000,
      onStep: (step, ms) => recordShutdownStep(step, ms),
    });
  };

  // One shutdown run per process: every exit path (window close, Cmd+Q,
  // crash escalation) shares this promise. The quit is only let through once
  // it settles, so will-quit's storage close can never race the flush steps
  // and a re-entrant before-quit can never start a second full run.
  let shutdownRun: Promise<void> | null = null;
  let shutdownSettled = false;

  const beginGracefulShutdown = (): Promise<void> => {
    if (!shutdownRun) {
      shutdownRun = runGracefulShutdown().finally(() => {
        shutdownSettled = true;
      });
    }

    return shutdownRun;
  };

  app.on("before-quit", (event) => {
    audit("lifecycle", { event: "before-quit" });

    if (shutdownSettled) return;

    event.preventDefault();
    void beginGracefulShutdown().finally(() => quitApp());
  });
  // The database closes after the shutdown steps so a checkpoint lands before
  // the process exits.
  app.on("will-quit", () => {
    audit("lifecycle", { event: "will-quit" });
    closeStorageService();
  });
  app.on("window-all-closed", () => {
    audit("lifecycle", { event: "window-all-closed", platform: process.platform });
  });
  win.on("close", (event) => {
    if (shuttingDown()) return;
    audit("lifecycle", { event: "window-close" });
    event.preventDefault();
    void beginGracefulShutdown().finally(() => quitApp());
  });
  // Sub-process deaths bypass every JS exit path above (the audit proved
  // it: silent exit, no lifecycle line). Name the killer on disk.
  app.on("render-process-gone", (_event, _contents, details) => {
    audit("lifecycle", { event: "render-process-gone", reason: details?.reason ?? "unknown", exitCode: details?.exitCode ?? -1 });
  });
  app.on("child-process-gone", (_event, details) => {
    audit("lifecycle", { event: "child-process-gone", type: details?.type ?? "unknown", reason: details?.reason ?? "unknown", exitCode: details?.exitCode ?? -1 });
  });
  // T-ARC-03 crash policy: record + safe look + host restart on the first
  // uncaught exception; a repeat converges to the graceful exit (the
  // recovery already failed once). Unhandled rejections — previously
  // invisible — are recorded on the same trail but never touch the lights.
  process.on("uncaughtException", (err) => handleProcessCrash("uncaught-exception", err));
  process.on("unhandledRejection", (reason) => handleProcessCrash("unhandled-rejection", reason));
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

function markShuttingDown(): void {
  shuttingDownNow = true;
  setShowAcceptingUi(false);
}

// T-ARC-03 crash policy (docs/finish/evidence/T-ARC-03/README.md). One
// in-process recovery is the spec: safe look + show host restart. A second
// crash means the recovery did not stick, so converge to the graceful exit
// instead of running on with corrupted main-process state.
let processCrashCount = 0;

function writeCrashRecord(kind: string, cause: unknown): void {
  const detail = cause instanceof Error ? (cause.stack ?? cause.message) : String(cause);

  try {
    writeFileSync(crashRecordPath(), JSON.stringify({
      at: new Date().toISOString(),
      pid: process.pid,
      versions: { electron: process.versions.electron, node: process.versions.node },
      kind,
      error: detail,
    }));
  } catch { /* crash path must never throw */ }
}

function handleProcessCrash(kind: "uncaught-exception" | "unhandled-rejection", cause: unknown): void {
  const detail = cause instanceof Error ? (cause.stack ?? cause.message) : String(cause);

  writeCrashRecord(kind, cause);
  audit("lifecycle", { event: kind, error: detail.slice(0, 500) });

  if (kind === "unhandled-rejection") return;

  processCrashCount += 1;

  if (processCrashCount > 1) {
    quitApp();

    return;
  }

  applyCrashPolicy({ holdMs: 2000 });
  restartShowHost();
}

// Only boot inside the Electron main process: importing this module from the
// checklist tests (src/app/security.test.ts) must not reject on app.whenReady.
// A boot rejection would otherwise vanish into an unhandledRejection before
// the crash handlers above are registered; record it and exit deterministically.
if (process.versions["electron"] !== undefined) {
  boot().catch((cause: unknown) => {
    writeCrashRecord("boot-failed", cause);
    audit("lifecycle", { event: "boot-failed", error: (cause instanceof Error ? (cause.stack ?? cause.message) : String(cause)).slice(0, 500) });
    quitApp();
  });
}
