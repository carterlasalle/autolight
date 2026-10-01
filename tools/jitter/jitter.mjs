#!/usr/bin/env node
// Jitter harness (T-ARC-06, DS-08).
//
// Runs each clock timer strategy in a worker thread at 60 Hz for N minutes
// under the three T-ARC-01 loads and writes a JSON histogram per strategy:
//   idle             no applied load
//   renderer-freeze  parent event loop blocked 5 s at a time (P-56-ui-freeze)
//   db-burst         parent event loop blocked 500 ms at a time (T-ARC-01)
//
// The clock runs in the worker while loads block the parent, mirroring the
// DS-07 worker-thread mode: parent stalls must not move worker tick phase.
// Other host modes (utility-process, utility-process-worker) need an Electron
// owner run; pass --mode to label the output.
//
// Usage:
//   yarn workspace @autolight/show-host build
//   node tools/jitter/jitter.mjs --minutes 2 --out jitter.json
//   node tools/jitter/jitter.mjs --minutes 0.1 --strategies hybrid --loads idle
//
// Full owner run (first measured table for the evidence README):
//   node tools/jitter/jitter.mjs --minutes 5 --tickHz 60 --spinMs 1.5 \
//     --mode worker-thread --out docs/finish/evidence/T-ARC-06/jitter.json

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { hostname, platform } from "node:os";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const distClock = join(here, "..", "..", "packages", "show-host", "dist", "clock.js");

const LOADS = ["idle", "renderer-freeze", "db-burst"];
const STRATEGIES = ["interval", "timeout-spin", "hybrid"];

function flag(name, fallback) {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (arg === name) return argv[i + 1] ?? "true";
    if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
  }
  return fallback;
}

function splitList(value) {
  return String(value)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}
async function applyLoad(load, durationMs) {
  if (load === "idle") {
    await sleep(durationMs);
    return;
  }
  const stallMs = load === "renderer-freeze" ? 5000 : 500;
  const gapMs = load === "renderer-freeze" ? 10000 : 5000;
  const started = Date.now();
  // At least one stall per run even when the run is shorter than the gap.
  if (durationMs <= gapMs) {
    await sleep(Math.max(0, durationMs - stallMs));
    if (Date.now() - started < durationMs) blockMs(Math.min(stallMs, durationMs));
    return;
  }
  while (Date.now() - started < durationMs) {
    await sleep(gapMs);
    if (Date.now() - started >= durationMs) break;
    blockMs(Math.min(stallMs, durationMs - (Date.now() - started)));
  }
}

function runStrategy(strategy, { tickHz, spinMs, minutes }) {
  const ticks = Math.max(1, Math.round(minutes * 60 * tickHz));
  const workerCode = `
    const { parentPort, workerData } = await import("node:worker_threads");
    const { startClock } = await import(workerData.distUrl);
    startClock(workerData.strategy, {
      tickHz: workerData.tickHz,
      spinWindowMs: workerData.spinMs,
      ticks: workerData.ticks,
      onTick: (tick) => parentPort.postMessage(tick),
    });
  `;
  return new Promise((resolve, reject) => {
    const got = [];
    const worker = new Worker(workerCode, {
      eval: true,
      workerData: {
        distUrl: `file://${distClock}`,
        strategy,
        tickHz,
        spinMs,
        ticks,
      },
    });
    worker.on("message", (tick) => {
      got.push(tick);
    });
    worker.on("error", reject);
    worker.on("exit", (code) => {
      if (code !== 0) reject(new Error(`${strategy} worker exited with code ${code}`));
      else resolve(got);
    });
  });
}

function summarize(ticks, tickHz) {
  const jitter = ticks.map((tick) =>
    tick.actualNs <= tick.scheduledNs ? 0 : Number(tick.actualNs - tick.scheduledNs) / 1e6,
  );
  const sorted = [...jitter].sort((a, b) => a - b);
  const count = sorted.length;
  const rank = (q) => sorted[Math.min(count - 1, Math.max(0, Math.floor(q * (count - 1))))] ?? 0;
  const nominalMs = 1000 / tickHz;
  const buckets = [];
  for (let lo = 0; lo < 20; lo += 0.5) buckets.push({ lo, hi: lo + 0.5, count: 0 });
  const overflow = { lo: 20, hi: null, count: 0 };
  for (const sample of jitter) {
    const slot = buckets[Math.min(buckets.length - 1, Math.floor(sample / 0.5))];
    if (sample >= 20) overflow.count += 1;
    else slot.count += 1;
  }
  return {
    ticks: count,
    p50Ms: rank(0.5),
    p99Ms: rank(0.99),
    maxMs: count === 0 ? 0 : (sorted[count - 1] ?? 0),
    missedTicks: jitter.filter((sample) => sample > nominalMs * 1.5).length,
    histogramMs: [...buckets, overflow],
  };
}

async function main() {
  if (!existsSync(distClock)) {
    console.error(`jitter: missing ${distClock}; build first: yarn workspace @autolight/show-host build`);
    process.exit(1);
  }
  const minutes = Number(flag("--minutes", "1"));
  const tickHz = Number(flag("--tickHz", "60"));
  const spinMs = Number(flag("--spinMs", "1.5"));
  const mode = String(flag("--mode", "worker-thread"));
  const out = String(flag("--out", join(here, "jitter.json")));
  const strategies = splitList(flag("--strategies", STRATEGIES.join(","))).filter((s) => {
    if (!STRATEGIES.includes(s)) {
      console.error(`jitter: unknown strategy ${s} (want ${STRATEGIES.join(", ")})`);
      process.exit(1);
    }
    return true;
  });
  const loads = splitList(flag("--loads", LOADS.join(","))).filter((s) => {
    if (!LOADS.includes(s)) {
      console.error(`jitter: unknown load ${s} (want ${LOADS.join(", ")})`);
      process.exit(1);
    }
    return true;
  });
  if (!Number.isFinite(minutes) || minutes <= 0) {
    console.error("jitter: --minutes must be a positive number");
    process.exit(1);
  }

  const results = [];
  for (const strategy of strategies) {
    for (const load of loads) {
      const durationMs = minutes * 60 * 1000;
      const pending = runStrategy(strategy, { tickHz, spinMs, minutes });
      await applyLoad(load, durationMs);
      const ticks = await pending;
      results.push({ strategy, load, hostMode: mode, ...summarize(ticks, tickHz) });
      const last = results[results.length - 1];
      console.log(
        `${strategy}/${load}: n=${last.ticks} p50=${last.p50Ms.toFixed(2)}ms ` +
          `p99=${last.p99Ms.toFixed(2)}ms max=${last.maxMs.toFixed(2)}ms missed=${last.missedTicks}`,
      );
    }
  }

  const report = {
    tool: "tools/jitter/jitter.mjs",
    task: "T-ARC-06",
    host: hostname(),
    platform: platform(),
    node: process.version,
    startedAt: new Date().toISOString(),
    tickHz,
    spinWindowMsMs: spinMs,
    minutesPerRun: minutes,
    results,
  };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`jitter: wrote ${out}`);
}

await main();
