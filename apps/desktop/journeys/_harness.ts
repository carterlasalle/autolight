// Shared Electron E2E harness (T-QA-02, spec 126 desktop E2E class).
//
// Launches the real built app (dist/electron/main.cjs, not `yarn dev`) in
// Simulator mode with an isolated profile in a temp userData dir. Frames and
// timestamps come from the recording transport through the TEST-BUILD-ONLY
// channel `qa/recording-frames` (see note below). Linux CI runs under
// `xvfb-run` (F-X-16); macOS and Windows run natively.
//
// TEST-BUILD ONLY: `qa/recording-frames` is registered by main only when the
// test-build flag is set (AUTOLIGHT_TEST_BUILD=1). The release bundle scan in
// `yarn truth` greps dist bundles for `qa/recording-frames` and rejects any
// hit, so this channel can never ship in a release build.
import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const TEST_IPC_CHANNEL = "qa/recording-frames";

export interface RecordedFrame {
  fixture: string;
  cells: Array<[number, number, number]>;
  sentAtMs: number;
}

interface TestApiHolder {
  __autolightTestApi?: Record<string, (arg: unknown) => Promise<unknown> | unknown>;
}

export interface Harness {
  app: ElectronApplication;
  window: Page;
  userDataDir: string;
  monotonicMs: () => number;
  invokeTestChannel: (method: string, arg?: unknown) => Promise<unknown>;
  waitForReady: (timeoutMs?: number) => Promise<Page>;
  pressWithTimestamp: (key: string) => Promise<{ key: string; wallMs: number; monotonicMs: number }>;
  readFrames: () => Promise<RecordedFrame[]>;
  firstZeroFrameAfter: (
    frames: RecordedFrame[],
    t0WallMs: number,
  ) => RecordedFrame | null;
  screenshot: (name: string) => Promise<string>;
  close: () => Promise<void>;
}

const here = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(here, "..");
const mainEntry = join(desktopRoot, "dist", "electron", "main.cjs");

// Linux CI boots the app under xvfb-run (F-X-16); macOS and Windows run natively.
const underXvfb = process.platform === "linux";

export async function launchAutolight(): Promise<Harness> {
  const userDataDir = mkdtempSync(join(tmpdir(), "autolight-e2e-"));
  const shotsDir = join(userDataDir, "screenshots");
  mkdirSync(shotsDir, { recursive: true });
  // Chromium switches precede the app path on the Electron command line.
  const launchArgs = [`--user-data-dir=${userDataDir}`, mainEntry];
  const app = await electron.launch({
    args: launchArgs,
    cwd: desktopRoot,
    env: {
      ...process.env,
      AUTOLIGHT_TEST_BUILD: "1",
      AUTOLIGHT_SIMULATOR_MODE: "1",
      AUTOLIGHT_USER_DATA_DIR: userDataDir,
      ...(underXvfb ? { XVFB_RUN: "1" } : {}),
    } as Record<string, string>,
  });
  const t0 = Date.now();
  const monotonicMs = (): number => Date.now() - t0;

  const invokeTestChannel = async (method: string, arg?: unknown): Promise<unknown> =>
    app.evaluate(
      ({ ipcMain }: { ipcMain: unknown }, payload: { method: string; arg: unknown }) => {
        // Main-process internal: the test build registers __autolightTestApi on globalThis.
        const holder = globalThis as unknown as TestApiHolder;
        const api = holder.__autolightTestApi;
        if (!api) throw new Error(`test channel unavailable (ipcMain handlers: ${ipcMain ? "open" : "closed"})`);
        const fn = api[payload.method];
        if (!fn) throw new Error(`unknown test method: ${payload.method}`);
        return fn(payload.arg);
      },
      { method, arg },
    );

  const waitForReady = async (timeoutMs = 30000): Promise<Page> => {
    const window = await app.firstWindow({ timeout: timeoutMs });
    await window.waitForLoadState("domcontentloaded", { timeout: timeoutMs });
    await window.waitForFunction(
      () => document.querySelector("#root")?.children.length !== 0,
      { timeout: timeoutMs },
    );
    return window;
  };

  const harnessWindow = async (): Promise<Page> => {
    const first = app.windows()[0];
    if (first) return first;
    return app.firstWindow();
  };

  const pressWithTimestamp = async (key: string): Promise<{ key: string; wallMs: number; monotonicMs: number }> => {
    const window = await harnessWindow();
    const wallMs = Date.now();
    const mono = monotonicMs();
    await window.keyboard.press(key);
    return { key, wallMs, monotonicMs: mono };
  };

  const readFrames = async (): Promise<RecordedFrame[]> =>
    (await invokeTestChannel("frames")) as RecordedFrame[];

  const firstZeroFrameAfter = (
    frames: RecordedFrame[],
    t0WallMs: number,
  ): RecordedFrame | null => {
    for (const f of frames) {
      if (f.sentAtMs > t0WallMs && f.cells.every(([r, g, b]) => r === 0 && g === 0 && b === 0)) {
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
  };

  // Simulator mode is requested through AUTOLIGHT_SIMULATOR_MODE at launch
  // (isolated profile above). The test channel methods (stages, frames,
  // fixtures, ...) land with T-ARC-01/T-GOV-14; until then each
  // invokeTestChannel call fails and the journeys stay red by design.
  const window = await waitForReady();
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
