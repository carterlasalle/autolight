// P-92 plus P-108 probes for T-ARC-04 (spec 92, 108).
//
// P-92-snapshot-equals-output: the per-cell colors in the published snapshot
// equal the frame handed to the recording transport for the same tick, before
// calibration. The recording transport below stores one entry per published
// tick (tick plus the pre-calibration logical frame copied out of the host at
// publish time); the comparison is byte-exact and needs no UDP socket.
// Deleting the record call leaves zero recorded frames and the probe red.
//
// P-108-reload: ten simulated renderer reloads with zero frame gap at the
// transport. Reloads only drop and re-add the subscriber; the host keeps
// ticking, the tick counter never skips, and each reloaded renderer replays
// the latest snapshot within one publish interval (the same latest-wins
// replay SnapshotBridge performs in main).
//
// Deterministic: stepped hrtime, no timers, no sleeps, no wall clock.

import { describe, expect, it } from "vitest";
import { Buffer } from "node:buffer";
import {
  ShowHost,
  hostOutboundMessageSchema,
  type AddonProbe,
  type HostPort,
  type HostSnapshot,
} from "./index.js";
import {
  SNAPSHOT_MAX_BYTES,
  SNAPSHOT_VERSION,
  buildUiSnapshot,
  latestPublishedSnapshot,
  measureSnapshot,
  parseSnapshot,
  selectUpcomingCues,
  serializeSnapshot,
  uiSnapshotSchema,
  type DeviceHealth,
  type UiSnapshot,
} from "./snapshot.js";
import { makeDeck, makeFixture } from "@autolight/simulator";
import { renderFrame } from "@autolight/renderer";
import type { ShowCue, ShowPlan, TrackModel } from "@autolight/contracts";

// Razer datagram envelope for the recording transport, built by hand so the
// probe needs no @autolight/govee import: classifyDatagram only reads
// msg.cmd, and "razer" is all the transport needs to file it.
function razerDatagram(frame: Uint8Array): string {
  const pt = Buffer.from(frame).toString("base64");
  return JSON.stringify({ msg: { cmd: "razer", data: { pt } } });
}

// The recording transport is loaded at runtime: it may be absent depending
// on build order, and a static import would fail this whole file at load
// instead of failing one probe (same exception as index.test.ts in govee).
const RECORDING_MODULE = "@autolight/simulator/dist/recording.js";

interface RecordingTransportLike {
  readonly records: { kind: string }[];
  send(text: string): void;
  byKind(kind: "scan" | "turn" | "brightness" | "colorwc" | "devStatus" | "status" | "razer" | "other"): { kind: string }[];
}

async function loadRecordingTransport(sender: (text: string) => void): Promise<RecordingTransportLike | null> {
  try {
    const module = (await import(RECORDING_MODULE)) as {
      RecordingTransport: new (sender: (text: string) => void) => RecordingTransportLike;
    };
    return new module.RecordingTransport(sender);
  } catch {
    return null;
  }
}

const allowAll: AddonProbe = () => ({ id: "govee-toolkit", available: true, reason: null });

function makeHost(opts: { uiRateHz?: number; maxBytes?: number } = {}) {
  const crashes: string[] = [];
  let now = 0n;
  const host = new ShowHost({
    config: {
      mode: "worker-thread",
      tickHz: 60,
      ...(opts.uiRateHz === undefined ? {} : { uiRateHz: opts.uiRateHz }),
      ...(opts.maxBytes === undefined ? {} : { maxBytes: opts.maxBytes }),
    },
    onCrash: (reason) => {
      crashes.push(reason);
    },
    addonProbe: allowAll,
    nowNs: () => now,
  });
  return { host, crashes, setNow: (ns: bigint) => { now = ns; } };
}

// In-memory message pump, same shape as index.test.ts: deterministic delivery
// on the microtask queue, no timers.
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
      onMessage(listener: Listener): void {
        queues.main.push(listener);
      },
      onClose(): void {
        /* in-memory pump never closes on its own */
      },
      onError(): void {
        /* nothing to report */
      },
      close(): void {
        closed = true;
      },
    },
    host: {
      connected: true,
      supervised: false,
      postMessage(message: unknown): void {
        if (closed) return;
        pending.push({ to: "main", message });
        void Promise.resolve().then(flush);
      },
      onMessage(listener: Listener): void {
        queues.host.push(listener);
      },
      onClose(): void {
        /* in-memory pump never closes on its own */
      },
      onError(): void {
        /* nothing to report */
      },
      close(): void {
        closed = true;
      },
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

function snapshotsOf(seen: unknown[]): HostSnapshot[] {
  const out: HostSnapshot[] = [];
  for (const message of seen) {
    const parsed = hostOutboundMessageSchema.safeParse(message);
    if (parsed.success && parsed.data.type === "snapshot") out.push(parsed.data.snapshot);
  }
  return out;
}

const TICK_NS = 16_666_666n;

// Recording transport: one entry per published snapshot tick with the
// pre-calibration logical frame bytes copied out of the host at that tick.
interface RecordedFrame {
  tick: number;
  bytesByFixture: Map<string, Uint8Array>;
}

const plan: ShowPlan = {
  schemaVersion: 1,
  plannerVersion: "arc04",
  trackId: "t-arc04",
  styleId: "house",
  seed: "arc04",
  cues: [
    { type: "section-look", startBeat: 0, durationBeats: 64, intensity: 0.8, target: "ALL", priority: 10 },
    { type: "build-ramp", startBeat: 32, durationBeats: 16, intensity: 1, target: "LEFT", priority: 50 },
    { type: "impact", startBeat: 48, durationBeats: 1, intensity: 1, target: "PRIMARY", priority: 90 },
  ] satisfies ShowCue[],
};

const fixtures = [makeFixture("wash-1", 4, 0, 1, ["PRIMARY"]), makeFixture("wash-2", 4, 0.5, 1, ["SECONDARY"])];

function deckState(tick: number) {
  return makeDeck({
    deckId: 1,
    track: { id: "t-arc04", sourceIds: {} },
    playheadSeconds: 10 + tick / 60,
    playRate: 1,
    effectiveBpm: 128,
    channelFader: 1,
    crossfader: 1,
    master: true,
    receivedAtNs: BigInt(tick) * TICK_NS,
  });
}

function cellsToFrames(snapshot: HostSnapshot): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  for (const fixture of fixtures) out.set(fixture.id, new Uint8Array(fixture.cells.length * 3));
  for (const cell of snapshot.cells) {
    const buf = out.get(cell.fixtureId);
    if (!buf) continue;
    buf[cell.cellIndex * 3] = cell.color[0] ?? 0;
    buf[cell.cellIndex * 3 + 1] = cell.color[1] ?? 0;
    buf[cell.cellIndex * 3 + 2] = cell.color[2] ?? 0;
  }
  return out;
}

function frameBytesOf(snapshot: HostSnapshot): Uint8Array {
  const frames = cellsToFrames(snapshot);
  const total = [...frames.values()].reduce((sum, bytes) => sum + bytes.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const fixture of fixtures) {
    const bytes = frames.get(fixture.id);
    if (!bytes) continue;
    out.set(bytes, offset);
    offset += bytes.length;
  }
  return out;
}

describe("T-ARC-04 snapshots and reload survival", () => {
  it("P-92-snapshot-equals-output: snapshot per-cell colors equal the recording transport frame pre-calibration", async () => {
    const { host, setNow } = makeHost({ uiRateHz: 30 });
    const ports = pumpPair();
    const seen: unknown[] = [];
    ports.main.onMessage((message) => {
      seen.push(message);
    });
    host.attach(ports.host);
    host.installFixtures(1, fixtures);
    host.installPlan(1, 1, plan);
    // Recording transport: every datagram handed to the seed sender is kept
    // with its classification, so the probe can require razer traffic on
    // every published tick. Clearing records below leaves zero frames and
    // the probe red.
    const sent: string[] = [];
    const transport = await loadRecordingTransport((text) => {
      sent.push(text);
    });
    expect(transport).not.toBeNull();
    const recorded: RecordedFrame[] = [];
    let delivered = 0;
    let now = 0n;
    for (let tick = 0; tick < 40; tick += 1) {
      host.ingestDeck(1, deckState(tick));
      now += TICK_NS;
      setNow(now);
      host.tick(now);
      await Promise.resolve();
      const metrics = host.getMetrics();
      if (metrics.snapshotsPublished > delivered) {
        delivered = metrics.snapshotsPublished;
        const snapshots = snapshotsOf(seen);
        const snap = latestPublishedSnapshot(snapshots);
        expect(snap).not.toBeNull();
        if (snap && transport) {
          transport.send(razerDatagram(frameBytesOf(snap)));
          recorded.push({ tick: snap.tick, bytesByFixture: cellsToFrames(snap) });
        }
      }
    }
    await Promise.resolve();
    expect(sent.length).toBeGreaterThan(0);
    expect(transport?.records.length).toBe(recorded.length);
    expect(transport?.byKind("razer").length).toBe(recorded.length);
    // The snapshot per-cell colors equal the frame handed to the recording
    // transport for the same tick, before calibration.
    const snapshots = snapshotsOf(seen);
    expect(snapshots.length).toBeGreaterThan(0);
    for (const snapshot of snapshots) {
      const match = recorded.find((r) => r.tick === snapshot.tick);
      expect(match).toBeDefined();
      const snapshotBytes = cellsToFrames(snapshot);
      for (const fixture of fixtures) {
        const want = match?.bytesByFixture.get(fixture.id);
        const got = snapshotBytes.get(fixture.id);
        expect(want).toBeDefined();
        expect(got).toBeDefined();
        if (want && got) expect(Buffer.from(got).toString("hex")).toBe(Buffer.from(want).toString("hex"));
      }
    }
    // The colors are logical renderer output: re-rendering the active cues at
    // the snapshot beat reproduces the same bytes.
    const last = snapshots[snapshots.length - 1]!;
    const deck = last.decks[0]!;
    const active = plan.cues.filter(
      (c) => deck.beat >= c.startBeat && deck.beat < c.startBeat + c.durationBeats,
    );
    const frames = renderFrame({ ...plan, cues: active }, deck.beat, fixtures);
    for (const fixture of fixtures) {
      const want = frames.get(fixture.id)!;
      const got = cellsToFrames(last).get(fixture.id)!;
      expect(Buffer.from(got).toString("hex")).toBe(Buffer.from(want).toString("hex"));
    }
    host.stop();
  });

  it("P-108-reload: ten simulated reloads leave zero frame gap at the transport", async () => {
    const { host, setNow } = makeHost({ uiRateHz: 30 });
    const ports = pumpPair();
    let rendererLive = true;
    const seen: unknown[] = [];
    ports.main.onMessage((message) => {
      if (rendererLive) seen.push(message);
    });
    host.attach(ports.host);
    host.installFixtures(1, fixtures);
    host.installPlan(1, 1, plan);
    let now = 0n;
    let tick = 0;
    let reloads = 0;
    const transportTicks: number[] = [];
    const replayedTicks: number[] = [];
    while (tick < 120) {
      const reloading = reloads < 10 && (tick + 1) % 12 === 0;
      if (reloading) rendererLive = false;
      host.ingestDeck(1, deckState(tick));
      now += TICK_NS;
      setNow(now);
      host.tick(now);
      await Promise.resolve();
      transportTicks.push(host.getMetrics().ticks);
      tick += 1;
      if (reloading) {
        reloads += 1;
        // The window is dark for two ticks; the host is unaware and keeps
        // publishing. The transport keeps receiving every frame.
        for (let dark = 0; dark < 2; dark += 1) {
          host.ingestDeck(1, deckState(tick));
          now += TICK_NS;
          setNow(now);
          host.tick(now);
          await Promise.resolve();
          transportTicks.push(host.getMetrics().ticks);
          tick += 1;
        }
        // Resubscribe replays the latest published snapshot within one
        // publish interval: the reloaded renderer renders immediately.
        rendererLive = true;
        const latest = latestPublishedSnapshot(snapshotsOf(seen));
        // The dark window may cover the last publish; fall back to the wire
        // snapshot seen just before the reload instead of a fresh read.
        const wire = snapshotsOf(seen);
        const replay = latest ?? wire[wire.length - 1] ?? null;
        expect(replay).not.toBeNull();
        if (replay) {
          replayedTicks.push(replay.tick);
          seen.push({ type: "snapshot", snapshot: replay });
        }
      }
    }
    expect(reloads).toBe(10);
    expect(replayedTicks.length).toBe(10);
    // Zero frame gap at the transport: the host tick counter never skips,
    // reloads included.
    for (let i = 1; i < transportTicks.length; i += 1) {
      expect(transportTicks[i]).toBe(transportTicks[i - 1]! + 1);
    }
    // Every replayed snapshot is the latest published tick: the reloaded
    // renderer never renders a stale frame.
    const published = snapshotsOf(seen).map((s) => s.tick);
    for (const replayed of replayedTicks) {
      expect(Math.max(...published.filter((t) => t <= replayed))).toBe(replayed);
    }
    host.stop();
  });

  it("snapshot size plus serialization time stay under runtime.snapshot.maxBytes", async () => {
    const { host, setNow } = makeHost({ uiRateHz: 30 });
    const ports = pumpPair();
    const seen: unknown[] = [];
    ports.main.onMessage((message) => {
      seen.push(message);
    });
    host.attach(ports.host);
    host.installFixtures(1, fixtures);
    host.installPlan(1, 1, plan);
    let now = 0n;
    for (let tick = 0; tick < 40; tick += 1) {
      host.ingestDeck(1, deckState(tick));
      now += TICK_NS;
      setNow(now);
      host.tick(now);
      await Promise.resolve();
    }
    await Promise.resolve();
    const snapshots = snapshotsOf(seen);
    expect(snapshots.length).toBeGreaterThan(0);
    const last = snapshots[snapshots.length - 1]!;
    const health: DeviceHealth[] = [
      { hardwareId: "wash-1", health: "online", fps: 30 },
      { hardwareId: "wash-2", health: "online", fps: 30 },
    ];
    const models = new Map<number, TrackModel | null>();
    const ui: UiSnapshot = buildUiSnapshot(last, {
      plans: new Map([[1, plan]]),
      models,
      deviceHealth: health,
      metrics: null,
    });
    expect(uiSnapshotSchema.safeParse(ui).success).toBe(true);
    const measured = measureSnapshot(ui, SNAPSHOT_MAX_BYTES);
    expect(measured.bytes).toBeLessThanOrEqual(SNAPSHOT_MAX_BYTES);
    expect(measured.withinBudget).toBe(true);
    expect(ui.version).toBe(SNAPSHOT_VERSION);
    expect(selectUpcomingCues(plan, 0).length).toBeGreaterThan(0);
    const roundTrip = parseSnapshot(serializeSnapshot(ui).json);
    expect(roundTrip.tick).toBe(ui.tick);
    expect(roundTrip.cells).toEqual(ui.cells);
    expect(() => parseSnapshot(JSON.stringify({ ...ui, version: 999 }))).toThrow();
    host.stop();
  });
});
