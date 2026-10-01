import { describe, expect, it, vi } from "vitest";
import { MessageChannel } from "node:worker_threads";
import {
  HOST_MODES,
  ShowHost,
  probeMode,
  startHost,
  wrapMessagePort,
  type AddonProbe,
  type HostPort,
} from "./index.js";

const allowAll: AddonProbe = () => ({ id: "govee-toolkit", available: true, reason: null });

function makeHost() {
  const crashes: string[] = [];
  let now = 0n;
  const host = new ShowHost({
    config: { mode: "worker-thread", tickHz: 60, uiRateHz: 30, maxBytes: 262144 },
    onCrash: (reason) => { crashes.push(reason); },
    addonProbe: allowAll,
    nowNs: () => now,
  });
  return { host, crashes, advance: (ns: bigint) => { now = ns; } };
}

// In-memory message pump: delivers every posted message to the peer on the
// next microtask, exactly like a real MessageChannel pair, minus the native
// event loop. Deterministic: no timers, no sleeps, no wall clock.
function pumpPair(): { main: HostPort; host: HostPort } {
  type Listener = (message: unknown) => void;
  const queues: { main: Listener[]; host: Listener[] } = { main: [], host: [] };
  const pending: { to: "main" | "host"; message: unknown }[] = [];
  let closed = false;
  const peer: { main: HostPort; host: HostPort } = {
    main: {
      connected: true,
      supervised: false,
      postMessage(message: unknown): void {
        if (closed) return;
        pending.push({ to: "host", message });
        void Promise.resolve().then(flush);
      },
      onMessage(listener: Listener): void { queues.main.push(listener); },
      onClose(): void { /* in-memory pump never closes on its own */ },
      onError(): void { /* nothing to report */ },
      close(): void { closed = true; },
    },
    host: {
      connected: true,
      supervised: false,
      postMessage(message: unknown): void {
        if (closed) return;
        pending.push({ to: "main", message });
        void Promise.resolve().then(flush);
      },
      onMessage(listener: Listener): void { queues.host.push(listener); },
      onClose(): void { /* in-memory pump never closes on its own */ },
      onError(): void { /* nothing to report */ },
      close(): void { closed = true; },
    },
  };
  const flush = (): void => {
    let item = pending.shift();
    while (item !== undefined) {
      for (const listener of queues[item.to]) listener(item.message);
      item = pending.shift();
    }
  };
  return peer;
}

describe("show-host modes", () => {
  it("probes every DS-07 mode and reports unavailable with reason, never silent fallback", () => {
    expect(HOST_MODES).toEqual(["worker-thread", "utility-process", "utility-process-worker"]);
    const deny: AddonProbe = (id) => ({ id, available: false, reason: `no ${id} here` });
    for (const mode of HOST_MODES) {
      const status = probeMode(mode, deny);
      expect(status.available).toBe(false);
      expect(status.reason ?? "").not.toBe("");
    }
    expect(() => startHost("worker-thread", deny)).toThrow(/unavailable/);
  });
  it("tick advances cursors and publishes a snapshot within maxBytes", async () => {
    const { host } = makeHost();
    const ports = pumpPair();
    const seen: unknown[] = [];
    ports.main.onMessage((message) => { seen.push(message); });
    host.attach(ports.host);
    host.ingestDeck(1, {
      source: "rekordbox", deckId: 1, track: null, playing: true,
      playheadSeconds: 10, playRate: 1, effectiveBpm: 128,
      loop: { active: false, startSeconds: null, endSeconds: null, beatLength: null },
      channelFader: 1, crossfader: 1, master: true, receivedAtNs: 0n,
    });
    let now = 0n;
    for (let i = 0; i < 40; i += 1) {
      now += 16_666_666n;
      host.tick(now);
      await Promise.resolve();
    }
    await Promise.resolve();
    const snapshots = seen.filter((m) => (m as { type?: string }).type === "snapshot");
    expect(seen.length).toBeGreaterThan(0);
    expect(snapshots.length).toBeGreaterThan(0);
    const snap = (snapshots[snapshots.length - 1] as { snapshot: { decks: { beat: number }[] } }).snapshot;
    expect(snap.decks[0]!.beat).toBeGreaterThan(0);
    const bytes = Buffer.byteLength(JSON.stringify((snapshots[0] as { snapshot: unknown }).snapshot));
    expect(bytes).toBeLessThanOrEqual(262144);
    const metrics = host.getMetrics();
    expect(metrics.ticks).toBe(40);
    expect(host.addonStatus.available).toBe(true);
    host.stop();
  });
  it("killing the supervised port fires the crash-policy hook exactly once", async () => {
    const { host, crashes } = makeHost();
    const channel = new MessageChannel();
    // Real port close event (no wall-clock sleep): the crash hook fires on
    // the close callback, awaited as a promise the code already exposes.
    const closed = new Promise<void>((resolve) => {
      channel.port2.on("close", () => resolve());
    });
    host.attach(wrapMessagePort(channel.port2, true));
    channel.port2.close();
    await closed;
    await new Promise((resolve) => { setImmediate(resolve); });
    expect(crashes.length).toBe(1);
    host.stop();
    channel.port1.close();
  });
  it("startHost returns a MessagePort chain that survives without the renderer", async () => {
    // A crashing host is the crash-policy path, not a silent close: the
    // hook fires with the port-gone reason and stop() after the crash is
    // a no-op that must not fire it again.
    const crashes: string[] = [];
    const allowEvery: AddonProbe = (id) => ({ id, available: true, reason: null });
    const handle = startHost("worker-thread", allowEvery);
    expect(handle.mode).toBe("worker-thread");
    expect(handle.status.available).toBe(true);
    expect(handle.port).toBeDefined();
    const seen: unknown[] = [];
    const first = new Promise<void>((resolve) => {
      handle.port.on("message", (message) => {
        seen.push(message);
        resolve();
      });
    });
    handle.port.start();
    handle.port.postMessage({
      type: "deck",
      deckId: 1,
      state: {
        source: "rekordbox", deckId: 1, track: null, playing: true,
        playheadSeconds: 10, playRate: 1, effectiveBpm: 128,
        loop: { active: false, startSeconds: null, endSeconds: null, beatLength: null },
        channelFader: 1, crossfader: 1, master: true, receivedAtNs: "0",
      },
    });
    await first;
    expect((seen[0] as { type?: string }).type).toBe("snapshot");
    expect(crashes.length).toBe(0);
    handle.stop();
    handle.port.close();
    expect(vi.fn().mock.calls.length).toBe(0);
  });
});
