// Shared Electron E2E harness (T-QA-02, spec 126 desktop E2E class).
//
// Launches the real built app (dist/electron/main.cjs, not `yarn dev`) in
// Simulator mode with an isolated profile in a temp userData dir. Frames and
// timestamps come from the recording transport through the TEST-BUILD-ONLY
// channel `qa/recording-frames` (see note below). Linux CI runs under
// `xvfb-run` (F-X-16); macOS and Windows run natively.
//
// TEST-BUILD ONLY: the harness API is compiled in only for test builds
// (`test:e2e` runs `scripts/build-main.mjs --test`; the flag is a build-time
// define, so release bundles dead-code-eliminate the whole surface). The
// release bundle scan (`yarn truth` -> tools/bundle-scan.mjs) rejects test
// markers in dist, so this surface can never ship in a release build.
import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { TestApi, TestApiChannel, TestApiChannelArg, TestApiChannelResult, TestApiResult } from "../electron/test-api-contract.js";

export const TEST_IPC_CHANNEL = "qa/recording-frames";

export type RecordedFrame = TestApiResult<"frames">[number];

export interface Harness {
  app: ElectronApplication;
  window: Page;
  userDataDir: string;
  monotonicMs: () => number;
  invokeTestChannel: <M extends TestApiChannel>(method: M, arg?: TestApiChannelArg<M>) => Promise<TestApiChannelResult<M>>;
  waitForReady: (timeoutMs?: number) => Promise<Page>;
  pressWithTimestamp: (key: string) => Promise<{ key: string; wallMs: number; monotonicMs: number }>;
  readFrames: () => Promise<RecordedFrame[]>;
  firstZeroFrameAfter: (frames: RecordedFrame[], topWallMs: number) => RecordedFrame | null;
  screenshot: (name: string) => Promise<string>;
  close: () => Promise<void>;
}

const here = dirname(fileURLToPath(import.meta.url));

const desktopRoot = resolve(here, "..");

const mainEntry = join(desktopRoot, "dist", "electron", "main.cjs");

// Linux CI boots the app under xvfb-run (F-X-16); macOS and Windows run natively.
const underXvfb = process.platform === "linux";

/** Environment block for the Electron launch: the parent environment plus
 * the test-mode switches. */
type LaunchEnv = Record<string, string>;

// Every implemented method result, as the union the serialized dispatcher
// can produce; unwired channels throw and never appear here.
type TestApiOutcome = TestApiResult<keyof TestApi>;

// The wire shape of one call. Serialized as JSON before it crosses into the
// main process; methods without arguments carry no `arg` key at all.
type SerializedCall =
  | { method: "stages" | "library" | "fixtures" | "decks" | "plan" | "frames" | "commands" | "snapshot" | "resume-status" | "shutdown" }
  | { method: "freeze-renderer"; arg: { ms?: number } | undefined }
  | { method: "key"; arg: { key?: string } | undefined }
  | { method: "normal-night-row"; arg: { row?: string } | undefined };

// Runs inside the Electron main process (serialized by Playwright: it must
// not close over anything — all input arrives as arguments). Dispatches one
// concrete arm per method so the compile-time contract is enforced here.
async function invokeTestApiCall(context: { ipcMain: unknown }, encoded: string): Promise<TestApiOutcome> {
  // SAFETY: __autolightTestApi is written only by registerTestApi in the
  // --test main bundle; the shared TestApi contract pins its shape.
  const api = (globalThis as { __autolightTestApi?: TestApi }).__autolightTestApi;

  if (!api) throw new Error(`test channel unavailable (ipcMain handlers: ${context.ipcMain ? "open" : "closed"})`);

  const call: SerializedCall = JSON.parse(encoded);

  switch (call.method) {
    case "stages": return api.stages();
    case "library": return api.library();
    case "fixtures": return api.fixtures();
    case "decks": return api.decks();
    case "plan": return api.plan();
    case "frames": return api.frames();
    case "commands": return api.commands();
    case "snapshot": return api.snapshot();
    case "resume-status": return api["resume-status"]();
    case "freeze-renderer": return api["freeze-renderer"](call.arg);
    case "key": return api.key(call.arg);
    case "shutdown": return api.shutdown();
    case "normal-night-row": throw new Error(`test channel not wired yet: ${call.method} (T-QA-11 acceptance rows)`);
  }
}

export async function launchAutolight(): Promise<Harness> {
  const userDataDir = mkdtempSync(join(tmpdir(), "autolight-e2e-"));
  const shotsDir = join(userDataDir, "screenshots");
  mkdirSync(shotsDir, { recursive: true });
  // Chromium switches precede the app path on the Electron command line.
  const launchArgs = [`--user-data-dir=${userDataDir}`, mainEntry];

  // process.env values are string|undefined; the launch env takes concrete
  // strings, so drop undefined entries instead of asserting the whole object.
  const launchEnv: LaunchEnv = {};

  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined) launchEnv[name] = value;
  }

  launchEnv["AUTOLIGHT_TEST_BUILD"] = "1";
  launchEnv["AUTOLIGHT_SIMULATOR_MODE"] = "1";
  launchEnv["AUTOLIGHT_USER_DATA_DIR"] = userDataDir;

  if (underXvfb) launchEnv["XVFB_RUN"] = "1";

  const app = await electron.launch({ args: launchArgs, cwd: desktopRoot, env: launchEnv });

  const monoOrigin = performance.now();
  // Wall time stays Date.now() where it must correlate with frame sentAtMs;
  // monotonic time uses performance.now() so elapsed comparisons can never
  // jump on clock adjustments.
  const monotonicMs = (): number => performance.now() - monoOrigin;

  const invokeTestChannel = async <M extends TestApiChannel>(method: M, arg?: TestApiChannelArg<M>): Promise<TestApiChannelResult<M>> => {
    const outcome = await app.evaluate<TestApiOutcome, string>(invokeTestApiCall, JSON.stringify({ method, arg }));

    // SAFETY: the main-side switch dispatches on the same channel key, so at
    // runtime the outcome is exactly M's result (and unwired channels throw
    // before returning); both sides share the TestApi contract.
    return outcome as TestApiChannelResult<M>;
  };

  const waitForReady = async (timeoutMs = 30000): Promise<Page> => {
    const window = await app.firstWindow({ timeout: timeoutMs });
    await window.waitForLoadState("domcontentloaded", { timeout: timeoutMs });
    // `?.children.length !== 0` resolves on the first poll while #root is
    // still absent (undefined !== 0 is true); require actual mounted children.
    await window.waitForFunction(
      () => (document.querySelector("#root")?.children.length ?? 0) > 0,
      { timeout: timeoutMs },
    );

    return window;
  };

  // Anything that needs a window reuses the one waitForReady validated;
  // before ready, fall back to the app's first window.
  let validatedWindow: Page | null = null;

  const harnessWindow = async (): Promise<Page> => {
    if (validatedWindow) return validatedWindow;

    const first = app.windows()[0];

    if (first) return first;

    return app.firstWindow();
  };

  const pressWithTimestamp = async (key: string): Promise<{ key: string; wallMs: number; monotonicMs: number }> => {
    const wallMs = Date.now();
    const mono = monotonicMs();
    // Single authoritative dispatch: the TestChannel loop drives the
    // simulated show every journey assertion reads. Mirroring this into a
    // page-level keypress would drive the renderer->IPC pipeline as well and
    // can double-apply the key.
    await invokeTestChannel("key", { key });

    return { key, wallMs, monotonicMs: mono };
  };

  const readFrames = async (): Promise<RecordedFrame[]> => invokeTestChannel("frames");

  const firstZeroFrameAfter = (
    frames: RecordedFrame[],
    topWallMs: number,
  ): RecordedFrame | null => {
    for (const f of frames) {
      if (f.sentAtMs > topWallMs && f.cells.every(([r, g, b]) => r === 0 && g === 0 && b === 0)) {
        return f;
      }
    }

    return null;
  };

  const screenshot = async (name: string): Promise<string> => {
    const window = await harnessWindow();
    const path = join(shotsDir, `${name}.png`);
    await window.screenshot({ path });

    return path;
  };

  const close = async (): Promise<void> => {
    await app.close();
    // The app has released its handles: remove the isolated profile so every
    // run does not leak a directory under the OS temp dir.
    rmSync(userDataDir, { recursive: true, force: true });
  };

  // Simulator mode is requested through AUTOLIGHT_SIMULATOR_MODE at launch
  // (isolated profile above); the channel above is backed by the --test
  // main bundle's registerTestApi and its simulator show loop.
  let window: Page;

  try {
    window = await waitForReady();
  } catch (err) {
    // A failed ready-wait must not strand the Electron process or the temp
    // profile for the rest of the CI job.
    try {
      await app.close();
    } catch { /* the app never became ready; close is best-effort here */ }

    rmSync(userDataDir, { recursive: true, force: true });

    throw err;
  }

  validatedWindow = window;

  return {
    app,
    window,
    userDataDir,
    monotonicMs,
    invokeTestChannel,
    waitForReady,
    pressWithTimestamp,
    readFrames,
    firstZeroFrameAfter,
    screenshot,
    close,
  };
}
