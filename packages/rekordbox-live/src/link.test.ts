import { once } from "node:events";
import { describe, expect, it } from "vitest";
import {
  LINK_DEFAULT_QUANTUM,
  SidecarLinkTransport,
  linkBeatDisagreement,
  parseSidecarLine,
  resolveLinkMode,
  startFakeSidecar,
  stopFakeSidecar,
} from "./link.js";

describe("Ableton Link participation (T-LIVE-12, DS-36)", () => {
  it("parses the sidecar tempo grammar and rejects garbage", () => {
    const parsed = parseSidecarLine('{"tempo":128,"beat":16.5,"phase":0.5,"quantum":4,"playing":true}', 7n);
    expect(parsed).toMatchObject({ tempo: 128, beat: 16.5, phase: 0.5, quantum: 4, playing: true, atNs: 7n });
    expect(parseSidecarLine("garbage", 1n)).toBeNull();
    expect(parseSidecarLine('{"tempo":"fast"}', 1n)).toBeNull();
    expect(LINK_DEFAULT_QUANTUM).toBe(4);
  });

  it("resolves sidecar, sdk and auto per DS-36 without bundling the SDK", () => {
    expect(resolveLinkMode({ mode: "sidecar", sidecarPresent: true, sdkLicensed: false }).mode).toBe("sidecar");
    expect(resolveLinkMode({ mode: "sidecar", sidecarPresent: false, sdkLicensed: false }).mode).toBe("unavailable");
    expect(resolveLinkMode({ mode: "sdk", sidecarPresent: false, sdkLicensed: false }).mode).toBe("unavailable");
    expect(resolveLinkMode({ mode: "sdk", sidecarPresent: false, sdkLicensed: true }).mode).toBe("sdk");
    expect(resolveLinkMode({ mode: "auto", sidecarPresent: true, sdkLicensed: false }).mode).toBe("sidecar");
    expect(resolveLinkMode({ mode: "auto", sidecarPresent: false, sdkLicensed: true }).mode).toBe("sdk");
    const absent = resolveLinkMode({ mode: "auto", sidecarPresent: false, sdkLicensed: false });
    expect(absent.mode).toBe("unavailable");
    expect(absent.reason).toContain("UNAVAILABLE_ON_THIS_DEVICE");
  });

  it("tracks tempo and phase from a scripted sidecar over a real socket", async () => {
    const sidecar = await startFakeSidecar();
    try {
      // Wait for the server side to accept before sending. The client
      // connect event can fire before the fake sidecar registers the
      // socket, and an immediate send is then lost on the floor.
      const accepted = once(sidecar.server, "connection");
      const transport = new SidecarLinkTransport({ host: "127.0.0.1", port: sidecar.port });
      expect(transport.getStatus().state).toBe("unavailable");
      await transport.start();
      await accepted;
      const seen = Promise.withResolvers<void>();
      transport.onTempo((tempo) => {
        if (tempo.beat === 32) seen.resolve();
      });
      sidecar.send('{"tempo":124,"beat":32,"phase":0.25,"quantum":4,"playing":true}');
      await seen.promise;
      expect(transport.latest()).toMatchObject({ bpm: 124, beat: 32, phase: 0.25, quantum: 4, playing: true });
      expect(transport.getStatus().state).toBe("live");
      transport.publish({ tempo: 126 });
      const published = Promise.withResolvers<void>();
      const check = (): void => {
        if (sidecar.received.join("\n").includes("setTempo")) published.resolve();
        else setImmediate(check);
      };
      check();
      await published.promise;
      transport.ingest("garbage-line\n");
      expect(transport.rejectedCount()).toBe(1);
      await transport.stop();
    } finally {
      await stopFakeSidecar(sidecar);
    }
  });

  it("measures phase agreement for the fusion cross-check", () => {
    expect(linkBeatDisagreement(16.0, 16.1)).toBeCloseTo(0.1, 6);
    expect(linkBeatDisagreement(16, 17)).toBe(1);
  });
});
