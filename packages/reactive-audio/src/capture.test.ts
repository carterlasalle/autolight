// T-AUD-01 capture host outside React (DS-14): host resolution with the
// combined fallback, the device constraint applied exactly, real permission
// states, idempotent start and stop (one context, no leaked loops), reload
// survival, and a bounded latest-wins feature stream.

import { describe, expect, it } from "vitest";
import {
  AudioCaptureHost,
  captureConstraints,
  recommendLoopbackDevice,
  resolveCaptureHost,
  type CaptureConstraints,
  type CaptureDeviceInfo,
  type CapturePermission,
  type CaptureSessionHandle,
} from "./capture.js";
import type { LiveFeatures } from "./dsp.js";

function features(level: number): LiveFeatures {
  return {
    level,
    peak: level,
    bands: [level, 0, 0, 0],
    bandMix: [1, 0, 0, 0],
    mel: new Float64Array(1),
    flux: 0,
    onset: false,
    tempo: null,
    gain: 1,
  };
}

class FakePlatform {
  permission: CapturePermission = "granted";
  permissionRequests = 0;
  starts: CaptureConstraints[] = [];
  stops = 0;
  failStart = false;
  readonly devicesList: CaptureDeviceInfo[] = [];
  private nextId = 1;

  async requestPermission(): Promise<CapturePermission> {
    this.permissionRequests += 1;
    return this.permission;
  }

  async devices(): Promise<readonly CaptureDeviceInfo[]> {
    return this.devicesList;
  }

  async start(constraints: CaptureConstraints): Promise<CaptureSessionHandle> {
    if (this.failStart) throw new Error("no input device");
    this.starts.push(constraints);
    const id = `ctx-${this.nextId}`;
    this.nextId += 1;
    return { id, stop: () => { this.stops += 1; } };
  }
}

describe("audio capture host (T-AUD-01)", () => {
  it("resolves DS-14 modes, with the combined fallback recorded", () => {
    expect(resolveCaptureHost("audio-window", true)).toEqual({ host: "audio-window", fellBack: false });
    expect(resolveCaptureHost("renderer", true)).toEqual({ host: "renderer", fellBack: false });
    expect(resolveCaptureHost("audio-window-with-renderer-fallback", true)).toEqual({ host: "audio-window", fellBack: false });
    expect(resolveCaptureHost("audio-window-with-renderer-fallback", false)).toEqual({ host: "renderer", fellBack: true });
    const platform = new FakePlatform();
    const host = new AudioCaptureHost(platform, { mode: "audio-window-with-renderer-fallback", audioWindowAvailable: false });
    expect(host.status).toMatchObject({ host: "renderer", fellBack: true });
  });

  it("applies the audio.capture.deviceId constraint exactly", () => {
    expect(captureConstraints("")).toEqual({ audio: true });
    expect(captureConstraints("  ")).toEqual({ audio: true });
    expect(captureConstraints(" mic-2 ")).toEqual({ audio: { deviceId: { exact: "mic-2" } } });
  });

  it("starts once, stops once and switches device with one live context", async () => {
    const platform = new FakePlatform();
    const host = new AudioCaptureHost(platform, { deviceId: "", mode: "audio-window" });
    const first = await host.start();
    const second = await host.start();
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(platform.starts).toHaveLength(1);
    expect(host.status.sessionId).toBe("ctx-1");
    expect(host.status.running).toBe(true);
    expect(platform.permissionRequests).toBe(1);

    const switched = await host.setDevice("mic-2");
    expect(switched.ok).toBe(true);
    expect(platform.stops).toBe(1);
    expect(platform.starts).toHaveLength(2);
    expect(platform.starts[1]).toEqual({ audio: { deviceId: { exact: "mic-2" } } });
    expect(host.status.sessionId).toBe("ctx-2");

    host.stop();
    host.stop();
    expect(platform.stops).toBe(2);
    expect(host.status.running).toBe(false);
  });

  it("reports real permission states and never leaks a session on denial", async () => {
    const platform = new FakePlatform();
    platform.permission = "denied";
    const host = new AudioCaptureHost(platform);
    const denied = await host.start();
    expect(denied.ok).toBe(false);
    expect(denied.reason).toBe("permission denied");
    expect(host.status.permission).toBe("denied");
    expect(host.status.running).toBe(false);
    expect(platform.starts).toHaveLength(0);
    platform.permission = "granted";
    expect((await host.start()).ok).toBe(true);
    expect(host.status.permission).toBe("granted");
  });

  it("reports a failed start with its reason", async () => {
    const platform = new FakePlatform();
    platform.failStart = true;
    const host = new AudioCaptureHost(platform);
    const result = await host.start();
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("no input device");
    expect(host.status.reason).toBe("no input device");
    expect(host.status.running).toBe(false);
  });

  it("survives a UI reload in audio-window mode and dies with it in renderer mode", async () => {
    const windowPlatform = new FakePlatform();
    const windowHost = new AudioCaptureHost(windowPlatform, { mode: "audio-window" });
    await windowHost.start();
    windowHost.onUiReload();
    expect(windowHost.status.running).toBe(true);
    expect(windowHost.status.sessionId).toBe("ctx-1");
    expect(windowPlatform.stops).toBe(0);

    const rendererPlatform = new FakePlatform();
    const rendererHost = new AudioCaptureHost(rendererPlatform, { mode: "renderer" });
    await rendererHost.start();
    rendererHost.onUiReload();
    expect(rendererHost.status.running).toBe(false);
    expect(rendererPlatform.stops).toBe(1);
    expect(rendererHost.status.reason).toContain("ui-reload");
  });

  it("keeps the feature stream bounded and latest-wins", async () => {
    const platform = new FakePlatform();
    const host = new AudioCaptureHost(platform);
    await host.start();
    host.publish(features(0.1));
    host.publish(features(0.2));
    host.publish(features(0.3));
    expect(host.status.received).toBe(3);
    expect(host.status.superseded).toBe(2);
    expect(host.latest()?.level).toBe(0.3);
    expect(host.latest()).toBeNull();
  });

  it("recommends a loopback device for capturing the DJ output", () => {
    const devices: CaptureDeviceInfo[] = [
      { deviceId: "mic-1", label: "Built-in Mic", loopback: false },
      { deviceId: "loop-1", label: "DJ Mix Loopback", loopback: true },
    ];
    expect(recommendLoopbackDevice(devices)?.deviceId).toBe("loop-1");
    expect(recommendLoopbackDevice([devices[0]!])).toBeNull();
  });
});
