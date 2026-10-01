import { describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { estimatePosition } from "@autolight/dj-core";
import { blackoutPayload, encodeRaw, envelope, FrameCoalescer, OPCODE } from "@autolight/govee";
import { channels } from "@autolight/ipc";
import { renderFrame } from "@autolight/renderer";
import { makeDeck, makeFixture } from "@autolight/simulator";
import { showPlanSchema } from "@autolight/contracts";
import { configSnapshotHash } from "./cache.js";
import {
  createMeasurementFile,
  defaultThresholds,
  failedMeasurements,
  measureTickJitter,
  notMeasured,
  relaxThresholds,
  stallDetected,
  summarise,
  timeSamples,
  unmeasured,
  writeMeasurement,
  type Measurement,
} from "./perf.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const evidenceDir = join(repoRoot, "docs", "finish", "evidence", "T-QA-05");
const measurementPath = process.env["AUTOLIGHT_PERF_OUT"] ?? join(evidenceDir, "measurement.json");

const ciSlack = process.env["CI"] ? 3 : 1;
const thresholds = relaxThresholds(defaultThresholds(), ciSlack);
const plan = showPlanSchema.parse(
  JSON.parse(readFileSync(join(repoRoot, "test-fixtures", "analysis", "live-deck1.showplan.json"), "utf8")),
);

describe("performance harness (T-QA-05, spec 117)", () => {
  it("measures every quantity and writes measurement.json (P-117)", async () => {
    // Show host tick period and jitter, with the UI-free case and a deliberate
    // 20 ms stall (the DoD red run for the jitter report).
    const cleanJitter = await measureTickJitter({ hz: 1000, durationMs: 120 });
    const stalledJitter = await measureTickJitter({ hz: 1000, durationMs: 200, stallMs: 20, stallAtTick: 60 });
    expect(cleanJitter.length).toBeGreaterThan(100);
    expect(stalledJitter.length).toBeGreaterThan(cleanJitter.length);
    expect(stallDetected(stalledJitter, 20)).toBe(true);
    expect(stallDetected(cleanJitter, 20)).toBe(false);

    // Render time per tick with 2,000 cells.
    const wide = makeFixture("wide", 2000, 0, 1, ["PRIMARY"]);
    expect(wide.cells.length).toBe(2000);
    const renderMs = timeSamples(() => {
      renderFrame(plan, 120, [wide]);
    }, 200);

    // IPC latency for an intent plus a snapshot, through the real channel
    // contracts (the transport itself is measured on the packaged app).
    const request = { version: 1 as const };
    const response = { ok: true as const, decks: [{ state: null, track: null, plan: null }], fixtures: [] };
    const ipcMs = timeSamples(() => {
      channels["show/live"].request.parse(request);
      channels["show/live"].response.parse(response);
    }, 200);

    // DJ message processing: beat position estimation per incoming message.
    const deck = makeDeck({ deckId: 1, playing: true, playheadSeconds: 42.5, effectiveBpm: 128 });
    const djMs = timeSamples(() => {
      estimatePosition(deck, 1_000_000_000n);
    }, 500);

    // Emergency latency: emergency request to LAN send, through the real
    // frame path (blackout payload, razer encode, envelope) into the transport
    // seam the datagram sender is wired to.
    const sends: string[] = [];
    const send = (text: string): void => {
      sends.push(text);
    };
    const emergencyMs = timeSamples(() => {
      send(envelope(encodeRaw(OPCODE.RGB_STREAM, blackoutPayload(14))));
    }, 200);
    expect(sends.length).toBe(200);
    expect(sends[0]).toContain('"cmd":"razer"');

    // Queue depth: the coalescer keeps at most one pending frame.
    const coalescer = new FrameCoalescer();
    for (let i = 0; i < 100; i += 1) coalescer.push(new Uint8Array(42));
    const first = coalescer.take();
    const second = coalescer.take();
    const depth = first && !second ? 1 : 2;
    expect(first).not.toBeNull();
    expect(second).toBeNull();

    const measurements: Measurement[] = [
      summarise("showHost.tickJitter", "ms", cleanJitter, { threshold: thresholds.tickJitterP99Ms, statistic: "p99" }),
      // The DoD red run: a deliberate 20 ms stall in the tick loop must show up
      // in the jitter report, so this entry fails by construction.
      summarise("showHost.tickJitterWith20msStall", "ms", stalledJitter, {
        threshold: thresholds.tickJitterP99Ms,
        statistic: "p99",
      }),
      summarise("render.perTick2000Cells", "ms", renderMs, { threshold: thresholds.renderP95Ms }),
      summarise("ipc.roundTrip", "ms", ipcMs, { threshold: thresholds.ipcP95Ms }),
      summarise("dj.messageProcessing", "ms", djMs, { threshold: thresholds.djProcessP95Ms }),
      summarise("emergency.requestToSend", "ms", emergencyMs, { threshold: thresholds.emergencyP99Ms, statistic: "p99" }),
      summarise("queue.maxDepth", "frames", [depth], { threshold: thresholds.maxQueueDepth, statistic: "max" }),
      notMeasured(
        "ui.frameTimeLive",
        "ms",
        thresholds.uiFrameP95Ms,
        "requires a renderer frame source (Electron window or browser); measured by the E2E harness on the packaged app",
      ),
    ];

    const file = createMeasurementFile({
      appName: JSON.parse(readFileSync(join(repoRoot, "apps", "desktop", "package.json"), "utf8")).name as string,
      appVersion: JSON.parse(readFileSync(join(repoRoot, "apps", "desktop", "package.json"), "utf8")).version as string,
      configHash: configSnapshotHash({
        "runtime.clock.tickHz": 60,
        "runtime.fastPath.budgetMs": 100,
        "storage.sqlite.synchronous": "NORMAL",
        "storage.sqlite.busyTimeoutMs": 5000,
        "qa.perf.ciSlack": 3,
      }),
      command: `vitest run src/perf.test.ts (${process.argv.slice(0, 2).join(" ")})`,
      ciSlack,
      thresholds,
      measurements,
    });

    mkdirSync(evidenceDir, { recursive: true });
    writeMeasurement(measurementPath, file);
    const written = JSON.parse(readFileSync(measurementPath, "utf8")) as typeof file;
    expect(written.machine.cpuCount).toBeGreaterThan(0);
    expect(written.machine.cpuModel.length).toBeGreaterThan(0);
    expect(written.app.version).toBe("0.1.0");
    expect(written.configHash).toHaveLength(16);
    expect(written.command).toContain("perf.test.ts");
    expect(written.measurements.length).toBe(8);
    expect(written.measurements.every((m) => m.samples > 0 || !m.measured)).toBe(true);
    expect(unmeasured(written).map((m) => m.name)).toEqual(["ui.frameTimeLive"]);
    expect(unmeasured(written).every((m) => (m.reason ?? "").length > 0)).toBe(true);
    // The reference thresholds are recorded for the tasks that own the
    // behaviours; the harness itself only proves it can see a stall.
    const jitter = written.measurements.find((m) => m.name === "showHost.tickJitterWith20msStall");
    console.info(
      `P-117: ${measurements
        .map((m) =>
          m.measured
            ? `${m.name} n=${m.samples} p50 ${m.p50.toFixed(2)} p95 ${m.p95.toFixed(2)} p99 ${m.p99.toFixed(2)} max ${m.max.toFixed(2)} ${m.unit}`
            : `${m.name} not measured`,
        )
        .join("; ")}`,
    );
    expect(jitter?.max).toBeGreaterThan(10);
    expect(renderMs.length).toBe(200);
    // Everything measured passes except the injected stall, which is the
    // saved red run for the jitter report.
    expect(failedMeasurements(file).map((m) => m.name)).toEqual(["showHost.tickJitterWith20msStall"]);
  });

  it("records relaxed thresholds for CI runs without comparing to the reference machine", () => {
    const relaxed = relaxThresholds(defaultThresholds(), 3);
    expect(relaxed.tickJitterP99Ms).toBe(15);
    expect(relaxed.emergencyP99Ms).toBe(300);
    expect(relaxed.maxQueueDepth).toBe(1);
    expect(defaultThresholds().tickJitterP99Ms).toBe(5);
    expect(defaultThresholds().emergencyP99Ms).toBe(100);
  });

  it("reports an unmeasured quantity as unmeasured, never as zero", () => {
    const missing = notMeasured("ui.frameTimeLive", "ms", 16.7, "no renderer in this process");
    expect(missing.measured).toBe(false);
    expect(missing.pass).toBe(false);
    expect(missing.samples).toBe(0);
    expect(missing.reason).toBe("no renderer in this process");
    const empty = summarise("x", "ms", [], { threshold: 1 });
    expect(empty.measured).toBe(false);
    expect(empty.reason).toContain("no samples");
  });

  it("summarises percentiles the caller asks for", () => {
    const samples = Array.from({ length: 100 }, (_value, index) => index);
    const p95 = summarise("sample", "ms", samples, { threshold: 95, statistic: "p95" });
    expect(p95.measured).toBe(true);
    expect(Math.round(p95.p50)).toBe(50);
    expect(Math.round(p95.p95)).toBe(94);
    expect(p95.max).toBe(99);
    expect(p95.pass).toBe(true);
    const strict = summarise("sample", "ms", samples, { threshold: 5, statistic: "p99" });
    expect(strict.pass).toBe(false);
  });

  it("keeps the deliberate stall visible in a saved red run", async () => {
    // A stall far above the threshold must fail the recorded check while the
    // clean run passes it: this is the red run evidence for T-QA-05.
    const clean = await measureTickJitter({ hz: 500, durationMs: 100 });
    const stalled = await measureTickJitter({ hz: 500, durationMs: 150, stallMs: 40, stallAtTick: 30 });
    const cleanCheck = summarise("showHost.tickJitter", "ms", clean, { threshold: 20, statistic: "p99" });
    const stalledCheck = summarise("showHost.tickJitter", "ms", stalled, { threshold: 20, statistic: "p99" });
    expect(cleanCheck.pass).toBe(true);
    expect(stalledCheck.pass).toBe(false);
    expect(stalledCheck.max).toBeGreaterThan(20);
  });

  it("keeps the evidence measurement.json parseable", () => {
    const file = JSON.parse(readFileSync(measurementPath, "utf8")) as { measurements: Measurement[]; generatedAt: string };
    expect(file.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(file.measurements.map((m) => m.name)).toContain("emergency.requestToSend");
  });
});
