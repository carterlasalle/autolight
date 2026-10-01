import { describe, expect, it } from "vitest";
import { DEFAULT_FUSION_AUTHORITY, ScriptedProvider, describeStatus } from "./providers.js";
import { FusionEngine, LatestWinsPort, ProviderManager } from "./fusion.js";

let now = 1_000n * 1_000_000_000n;
const clock = (): bigint => now;

function deckState(provider: ScriptedProvider, seconds: number, atNs: bigint, bpm = 128): void {
  provider.update({ deckId: 1, track: { id: "t1", title: "Track" }, playing: true, playheadSeconds: seconds, effectiveBpm: bpm, atNs });
}

describe("fusion engine (T-LIVE-02, DS-01)", () => {
  it("uses the DS-01 default authority order", () => {
    expect([...DEFAULT_FUSION_AUTHORITY]).toEqual([
      "lighting-ipc", "memory-cleanroom", "rkbx-osc", "prolink", "composite-flx4", "ax", "os2l",
    ]);
    const engine = new FusionEngine({ now: clock });
    expect([...engine.getOptions().authority]).toEqual([...DEFAULT_FUSION_AUTHORITY]);
  });

  it("takes each field from the highest-ranked fresh provider and labels it", () => {
    now = 1_000n * 1_000_000_000n;
    const engine = new FusionEngine({ now: clock });
    const rkbx = new ScriptedProvider({ id: "rkbx-osc", now: clock });
    const prolink = new ScriptedProvider({ id: "prolink", now: clock });
    rkbx.update({ deckId: 1, track: { id: "t1", title: "Track" }, playing: true, playheadSeconds: 10, effectiveBpm: 128, pitchPercent: 1.5, master: true, atNs: now });
    prolink.update({ deckId: 1, track: { id: "t1", title: "Track" }, playing: true, playheadSeconds: 10.5, effectiveBpm: 128, atNs: now });
    engine.ingest("rkbx-osc", rkbx.getDecks()[0]!);
    engine.ingest("prolink", prolink.getDecks()[0]!);
    const fused = engine.fused(1);
    expect(fused?.fieldSources.playheadSeconds).toBe("rkbx-osc");
    expect(fused?.fieldSources.track).toBe("rkbx-osc");
    expect(fused?.playheadSeconds).toBe(10);
    expect(fused?.quality.playheadSeconds).toBe("derived");
    expect(fused?.master).toBe(true);
    expect(engine.drainEvents().filter((e) => e.to === "rkbx-osc").length).toBeGreaterThan(0);
    expect(engine.counts()["rkbx-osc"]).toBeGreaterThan(0);
  });

  it("holds authority through one late packet and switches only after live.fusion.switchHoldMs", () => {
    now = 1_000n * 1_000_000_000n;
    const engine = new FusionEngine({ now: clock, authority: ["lighting-ipc", "prolink", "rkbx-osc"] });
    const rkbx = new ScriptedProvider({ id: "rkbx-osc", now: clock });
    const prolink = new ScriptedProvider({ id: "prolink", now: clock });
    deckState(rkbx, 10, now);
    engine.ingest("rkbx-osc", rkbx.getDecks()[0]!);
    expect(engine.fused(1)?.fieldSources.playheadSeconds).toBe("rkbx-osc");
    engine.drainEvents();

    // One prolink packet, then silence: it never holds long enough.
    deckState(prolink, 10.4, now);
    engine.ingest("prolink", prolink.getDecks()[0]!);
    now += 400n * 1_000_000n;
    deckState(rkbx, 10.1, now);
    engine.ingest("rkbx-osc", rkbx.getDecks()[0]!);
    now += 600n * 1_000_000n;
    deckState(rkbx, 10.2, now);
    engine.ingest("rkbx-osc", rkbx.getDecks()[0]!);
    expect(engine.fused(1)?.fieldSources.playheadSeconds).toBe("rkbx-osc");
    expect(engine.drainEvents().filter((e) => e.to === "prolink")).toHaveLength(0);

    // Prolink returns while rkbx-osc stays fresh: the better rank wins only
    // after the hold window.
    now += 600n * 1_000_000n;
    deckState(rkbx, 10.3, now);
    engine.ingest("rkbx-osc", rkbx.getDecks()[0]!);
    deckState(prolink, 10.5, now);
    engine.ingest("prolink", prolink.getDecks()[0]!);
    now += 200n * 1_000_000n;
    deckState(prolink, 10.6, now);
    engine.ingest("prolink", prolink.getDecks()[0]!);
    now += 200n * 1_000_000n;
    deckState(rkbx, 10.4, now);
    engine.ingest("rkbx-osc", rkbx.getDecks()[0]!);
    deckState(prolink, 10.7, now);
    engine.ingest("prolink", prolink.getDecks()[0]!);
    expect(engine.fused(1)?.fieldSources.playheadSeconds).toBe("rkbx-osc");
    now += 200n * 1_000_000n;
    deckState(rkbx, 10.5, now);
    engine.ingest("rkbx-osc", rkbx.getDecks()[0]!);
    deckState(prolink, 10.8, now);
    engine.ingest("prolink", prolink.getDecks()[0]!);
    expect(engine.fused(1)?.fieldSources.playheadSeconds).toBe("prolink");
    const events = engine.drainEvents();
    expect(events.some((e) => e.field === "playheadSeconds" && e.from === "rkbx-osc" && e.to === "prolink" && e.reason === "higher-authority")).toBe(true);
  });

  it("keeps a stale holder labelled stale until the takeover hold elapses", () => {
    now = 1_000n * 1_000_000_000n;
    const engine = new FusionEngine({ now: clock });
    const rkbx = new ScriptedProvider({ id: "rkbx-osc", now: clock });
    const prolink = new ScriptedProvider({ id: "prolink", now: clock });
    deckState(rkbx, 10, now);
    engine.ingest("rkbx-osc", rkbx.getDecks()[0]!);
    engine.drainEvents();
    now += 800n * 1_000_000n;
    deckState(prolink, 10.5, now);
    engine.ingest("prolink", prolink.getDecks()[0]!);
    expect(engine.fused(1)?.fieldSources.playheadSeconds).toBe("rkbx-osc");
    expect(engine.fused(1)?.quality.playheadSeconds).toBe("stale");
    now += 600n * 1_000_000n;
    deckState(prolink, 10.6, now);
    engine.ingest("prolink", prolink.getDecks()[0]!);
    expect(engine.fused(1)?.fieldSources.playheadSeconds).toBe("prolink");
    expect(engine.fused(1)?.quality.playheadSeconds).toBe("derived");
    const events = engine.drainEvents();
    expect(events.some((e) => e.reason === "stale-takeover" && e.to === "prolink")).toBe(true);
  });

  it("raises a diagnostic when playhead sources disagree by more than live.fusion.disagreeBeats", () => {
    now = 1_000n * 1_000_000_000n;
    const engine = new FusionEngine({ now: clock });
    const rkbx = new ScriptedProvider({ id: "rkbx-osc", now: clock });
    const prolink = new ScriptedProvider({ id: "prolink", now: clock });
    deckState(rkbx, 10.0, now);
    deckState(prolink, 10.5, now);
    engine.ingest("rkbx-osc", rkbx.getDecks()[0]!);
    engine.ingest("prolink", prolink.getDecks()[0]!);
    const diagnostics = engine.drainDiagnostics();
    const playhead = diagnostics.find((d) => d.field === "playheadSeconds");
    expect(playhead).toBeDefined();
    expect(playhead?.providers).toEqual(["rkbx-osc", "prolink"]);
    expect(playhead?.spread).toBeGreaterThan(0.25);

    now += 1_000n * 1_000_000n;
    deckState(prolink, 10.01, now);
    engine.ingest("prolink", prolink.getDecks()[0]!);
    expect(engine.drainDiagnostics()).toHaveLength(0);
  });

  it("forwards latest-wins per deck", () => {
    now = 1_000n * 1_000_000_000n;
    const engine = new FusionEngine({ now: clock });
    const port = new LatestWinsPort();
    const received: number[] = [];
    port.onDeckState((state) => received.push(state.playheadSeconds));
    const provider = new ScriptedProvider({ id: "rkbx-osc", now: clock });
    for (const seconds of [1, 2, 3]) {
      deckState(provider, seconds, now);
      engine.ingest("rkbx-osc", provider.getDecks()[0]!);
      const fused = engine.fused(1);
      if (fused) port.push(fused);
    }
    expect(port.drainPending()).toHaveLength(1);
    deckState(provider, 4, now);
    engine.ingest("rkbx-osc", provider.getDecks()[0]!);
    const latest = engine.fused(1);
    if (latest) port.push(latest);
    port.flush();
    expect(received).toEqual([4]);
    expect(port.drainPending()).toHaveLength(0);
  });
});

class FailingProvider extends ScriptedProvider {
  attempts = 0;
  private readonly failTimes: number;

  constructor(failTimes: number) {
    super({ id: "flaky", now: clock });
    this.failTimes = failTimes;
  }

  override async start(): Promise<void> {
    this.attempts += 1;
    if (this.attempts <= this.failTimes) throw new Error(`start failure ${this.attempts}`);
    await super.start();
  }
}

describe("provider manager (T-LIVE-02)", () => {
  it("restarts a failed provider with backoff and gives up after the budget", async () => {
    now = 1_000n * 1_000_000_000n;
    const scheduled: (() => void)[] = [];
    const flaky = new FailingProvider(1);
    const manager = new ProviderManager(
      { providers: [flaky], maxRestarts: 2, restartBackoffMs: 500 },
      { now: clock, schedule: (fn) => scheduled.push(fn) },
    );
    await manager.start();
    expect(flaky.attempts).toBe(1);
    expect(manager.statusesByName()["flaky"]?.state).toBe("failed");
    expect(scheduled).toHaveLength(1);
    scheduled.shift()?.();
    await manager.settleRestarts();
    expect(flaky.attempts).toBe(2);
    expect(manager.statusesByName()["flaky"]?.state).not.toBe("failed");
    await manager.stop();
  });

  it("exhausts the restart budget when start keeps failing", async () => {
    now = 1_000n * 1_000_000_000n;
    const scheduled: (() => void)[] = [];
    const always = new FailingProvider(Number.POSITIVE_INFINITY);
    const manager = new ProviderManager(
      { providers: [always], maxRestarts: 1, restartBackoffMs: 500 },
      { now: clock, schedule: (fn) => scheduled.push(fn) },
    );
    await manager.start();
    expect(scheduled).toHaveLength(1);
    scheduled.shift()?.();
    await manager.settleRestarts();
    expect(always.attempts).toBe(2);
    const status = manager.statusesByName()["flaky"];
    expect(status?.state).toBe("failed");
    expect(status?.state === "failed" ? status.error : "").toContain("restart budget exhausted");
    await manager.stop();
  });

  it("schedules a restart when a provider reports failed", async () => {
    now = 1_000n * 1_000_000_000n;
    const scheduled: (() => void)[] = [];
    const provider = new ScriptedProvider({ id: "rkbx-osc", now: clock });
    const manager = new ProviderManager({ providers: [provider], maxRestarts: 2 }, { now: clock, schedule: (fn) => scheduled.push(fn) });
    await manager.start();
    expect(scheduled).toHaveLength(0);
    provider.report({ state: "failed", error: "osc socket closed" });
    expect(manager.statusesByName()["rkbx-osc"]).toMatchObject({ error: "osc socket closed" });
    expect(scheduled).toHaveLength(1);
    scheduled.shift()?.();
    await manager.settleRestarts();
    expect(manager.statusesByName()["rkbx-osc"]?.state).toBe("starting");
    await manager.stop();
  });

  it("forwards fused deck state and reports status text", async () => {
    now = 1_000n * 1_000_000_000n;
    const provider = new ScriptedProvider({ id: "rkbx-osc", now: clock });
    const manager = new ProviderManager({ providers: [provider] }, { now: clock, schedule: () => {} });
    await manager.start();
    const received: number[] = [];
    manager.onDeckState((state) => received.push(state.playheadSeconds));
    deckState(provider, 12, now);
    manager.flush();
    expect(received).toEqual([12]);
    expect(manager.fusedDecks()[0]?.playheadSeconds).toBe(12);
    expect(manager.describe()[0]).toContain("rkbx-osc:");
    await manager.stop();
  });

  it("describes provider status in one string", () => {
    expect(describeStatus({ state: "live", updateHz: 120, ageMs: 8 })).toContain("live");
    expect(describeStatus({ state: "unavailable", reason: "no permission", remedy: "grant it" })).toContain("no permission");
    expect(describeStatus({ state: "failed", error: "boom" })).toContain("boom");
    expect(describeStatus({ state: "starting" })).toBe("starting");
  });
});
