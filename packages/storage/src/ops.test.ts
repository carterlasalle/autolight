import { describe, expect, it } from "vitest";
import {
  ConsentStore,
  consentTextFor,
} from "./consent.js";
import {
  Logger,
  validateLog,
  validateLogLine,
} from "./logging.js";
import {
  MetricsRegistry,
  METRIC_NAMES,
  histogramOf,
} from "./metrics.js";
import {
  auditListeners,
  oscMustRefuseRemote,
} from "./netaudit.js";
import {
  frameHashFor,
  parseSessionNdjson,
  replaySession,
  SessionRecorder,
} from "./session.js";

describe("session recorder and exact replay (T-DATA-06, F-DATA-06, spec 103)", () => {
  it("records bounded rings without shift() and exports ndjson", () => {
    const rec = new SessionRecorder({ enabled: true, maxMb: 0.001 });
    for (let tick = 0; tick < 200; tick++) {
      rec.record("tick-input", { tick, inputs: { deck: tick } }, tick);
      rec.record("frame-hash", { tick, hash: frameHashFor(tick, { deck: tick }, { style: "club" }) }, tick);
    }
    expect(rec.count).toBeGreaterThan(0);
    expect(rec.count).toBeLessThan(400);
    expect(rec.droppedCount).toBeGreaterThan(0);
    const lines = rec.exportNdjson().split("\n");
    expect(lines.length).toBe(rec.count);
    expect(parseSessionNdjson(rec.exportNdjson()).length).toBe(rec.count);
  });

  it("replays with 100 percent frame hash equality on the same snapshot", () => {
    const snapshot = { "mixer.crossfader.curve": "source", style: "club" };
    const rec = new SessionRecorder({ enabled: true, maxMb: 64 });
    for (let tick = 0; tick < 60; tick++) {
      rec.record("tick-input", { tick, inputs: { deck: tick % 4 } }, tick);
      rec.record("frame-hash", { tick, hash: frameHashFor(tick, { deck: tick % 4 }, snapshot) }, tick);
    }
    const result = replaySession(rec.entries(), snapshot, (tick, inputs, snap) =>
      frameHashFor(tick, inputs, snap),
    );
    expect(result.ticks).toBe(60);
    expect(result.mismatched).toBe(0);
    expect(result.matched).toBe(60);
  });

  it("fails replay when the render is deliberately nondeterministic", () => {
    const snapshot = { style: "club" };
    const rec = new SessionRecorder({ enabled: true, maxMb: 64 });
    for (let tick = 0; tick < 10; tick++) {
      rec.record("tick-input", { tick, inputs: {} }, tick);
      rec.record("frame-hash", { tick, hash: frameHashFor(tick, {}, snapshot) }, tick);
    }
    let calls = 0;
    const result = replaySession(rec.entries(), snapshot, () => `random-${calls++}`);
    expect(result.mismatched).toBe(10);
    expect(result.mismatchedTicks).toHaveLength(10);
  });

  it("rejects malformed session lines with line numbers", () => {
    expect(() => parseSessionNdjson("not json")).toThrow("session line 1");
    expect(() => parseSessionNdjson(JSON.stringify({ nope: 1 }))).toThrow("session line 1");
    expect(parseSessionNdjson("")).toEqual([]);
  });

  it("stays silent when disabled", () => {
    const rec = new SessionRecorder({ enabled: false, maxMb: 64 });
    rec.record("tick-input", { tick: 1 });
    expect(rec.count).toBe(0);
    expect(rec.exportNdjson()).toBe("");
  });
});

describe("structured logging (T-OPS-02, F-OPS-01, spec 130)", () => {
  it("emits JSON lines with the spec 130 fields and validates them (P-130)", () => {
    const lines: string[] = [];
    const logger = new Logger({ module: "show-host", session: "s1", sink: (l) => lines.push(l) });
    logger.info("tick", { deck: 1, track: "t1", fixture: "f1", event: "drop", latencyMs: 2 });
    expect(lines).toHaveLength(1);
    expect(validateLog(lines)).toEqual([]);
    const row = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(row["module"]).toBe("show-host");
    expect(row["severity"]).toBe("info");
    expect(row["session"]).toBe("s1");
    expect(typeof row["timestamp"]).toBe("string");
    expect(typeof row["monoMs"]).toBe("number");
  });

  it("drops raw protocol lines outside diagnostic mode and keeps them inside it", () => {
    const normal: string[] = [];
    new Logger({ module: "govee", sink: (l) => normal.push(l) }).debug("packet", { rawProtocol: "aa:bb" });
    expect(normal).toHaveLength(1);
    expect(JSON.parse(normal[0]!) as Record<string, unknown>).not.toHaveProperty("rawProtocol");
    expect(validateLog(normal)).toEqual([]);
    const diag: string[] = [];
    new Logger({ module: "govee", diagnosticMode: true, sink: (l) => diag.push(l) }).debug("packet", {
      rawProtocol: "aa:bb",
    });
    expect(JSON.parse(diag[0]!) as Record<string, unknown>).toHaveProperty("rawProtocol", "aa:bb");
    expect(validateLog(diag, true)).toEqual([]);
    expect(validateLog(diag, false)[0]?.problems.some((p) => p.includes("rawProtocol"))).toBe(true);
  });

  it("rate-limits repeated messages and rejects non-JSON lines", () => {
    const lines: string[] = [];
    let suppressed = 0;
    const logger = new Logger({
      module: "lan",
      maxRepeated: 2,
      windowMs: 60_000,
      now: () => 1000,
      sink: (l) => lines.push(l),
      onSuppressed: (n) => {
        suppressed += n;
      },
    });
    for (let i = 0; i < 5; i++) logger.warn("same storm");
    expect(lines).toHaveLength(2);
    expect(suppressed).toBe(3);
    expect(validateLogLine("not json")).toContain("line is not JSON");
  });
});

describe("metrics (T-OPS-03, F-OPS-02, spec 131)", () => {
  it("covers every spec 131 metric plus the plan additions", () => {
    for (const name of [
      "djUpdateRateHz",
      "djStateAgeMs",
      "clockCorrectionMs",
      "beatErrorMs",
      "renderTimeMs",
      "rendererFps",
      "deviceFps",
      "supersededFrames",
      "deviceLatencyMs",
      "analysisDurationMs",
      "plannerDurationMs",
      "ipcLatencyMs",
    ] as const) {
      expect(METRIC_NAMES).toContain(name);
    }
    for (const name of ["queueDrops", "failoverSwitches", "fusionAuthoritySwitches", "missedWatcherChanges"] as const) {
      expect(METRIC_NAMES).toContain(name);
    }
  });

  it("reports histograms with p50, p95, p99 and moves under activity", () => {
    const registry = new MetricsRegistry();
    expect(registry.snapshot()).toEqual({});
    for (let i = 1; i <= 100; i++) registry.observe("renderTimeMs", i);
    const snap = registry.snapshot();
    expect(snap["renderTimeMs"]?.count).toBe(100);
    expect(snap["renderTimeMs"]!.p50).toBeGreaterThan(0);
    expect(snap["renderTimeMs"]!.p95).toBeGreaterThan(snap["renderTimeMs"]!.p50);
    expect(snap["renderTimeMs"]!.p99).toBeGreaterThanOrEqual(snap["renderTimeMs"]!.p95);
    expect(registry.observedNames()).toContain("renderTimeMs");
    registry.observe("renderTimeMs", 200);
    expect(registry.histogram("renderTimeMs").max).toBe(200);
    expect(histogramOf([]).count).toBe(0);
  });

  it("counts discrete events without ever reading as a constant zero", () => {
    const registry = new MetricsRegistry();
    expect(registry.snapshot()["queueDrops"]).toBeUndefined();
    registry.count("queueDrops", 1, "lan");
    registry.count("failoverSwitches", 1);
    expect(registry.snapshot()["failoverSwitches"]?.max).toBe(1);
    expect(registry.histogram("queueDrops", "lan").max).toBe(1);
  });
});

describe("network exposure audit (T-SEC-02, spec 110/111)", () => {
  it("allows loopback, the Govee UDP ports and listed discovery, denies the rest", () => {
    const result = auditListeners([
      { name: "osc", host: "127.0.0.1", port: 4460, reason: "rkbx_link OSC input", loopbackOnly: true },
      { name: "govee-scan", host: "0.0.0.0", port: 4001, reason: "Govee LAN scan", loopbackOnly: false },
      { name: "prolink-discovery", host: "0.0.0.0", port: 50000, reason: "PRO DJ LINK discovery", loopbackOnly: false },
      { name: "control-server", host: "0.0.0.0", port: 8080, reason: "remote control", loopbackOnly: false },
    ]);
    expect(result.allowed).toHaveLength(3);
    expect(result.denied).toHaveLength(1);
    expect(result.denied[0]?.reason).toContain("control-server");
  });

  it("refuses non-loopback OSC bindings by default", () => {
    expect(oscMustRefuseRemote("0.0.0.0")).toBe(true);
    expect(oscMustRefuseRemote("127.0.0.1")).toBe(false);
    const result = auditListeners([
      { name: "osc", host: "0.0.0.0", port: 4460, reason: "OSC bound wide", loopbackOnly: true },
    ]);
    expect(result.denied).toHaveLength(1);
  });
});

describe("consent and audit for privileged helpers (T-SEC-05, F-SEC-03)", () => {
  it("requires explicit opt-in with timestamp and audits every start", () => {
    const store = new ConsentStore();
    expect(store.startHelper("memory-reader").ok).toBe(false);
    const text = consentTextFor("memory-reader");
    expect(text.needs.join(" ")).toContain("elevated");
    expect(text.undo.length).toBeGreaterThan(0);
    const record = store.grant("memory-reader", "hash-1", "2026-10-01T00:00:00.000Z");
    expect(record.consentedAt).toBe("2026-10-01T00:00:00.000Z");
    expect(store.startHelper("memory-reader")).toEqual({ ok: true });
    store.stopHelper("memory-reader");
    const actions = store.entries().map((e) => e.action);
    expect(actions).toEqual(["consent-granted", "start", "stop"]);
    store.revoke("memory-reader");
    expect(store.has("memory-reader")).toBe(false);
    expect(store.startHelper("memory-reader").ok).toBe(false);
  });
});
