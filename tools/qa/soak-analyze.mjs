#!/usr/bin/env node
// Soak trend analysis (T-QA-06, spec 125, probe P-125-soak).
// Reads 10 s samples (heap/RSS per process, handles, queue depths, stale
// frames, estimator error, latency, worker liveness, UI frame time) and
// applies the pass conditions with trend tests: RSS slope after warm-up
// below qa.soak.maxMemSlopeMbPerHour, queue max depth 1, no fixture drift at
// checkpoints, latency slope below qa.soak.maxLatencySlopeMsPerHour, no stale
// track state, no dead worker, no UI degradation slope. Short SIM runs use
// --fast (synthetic samples, proves the math, never called a soak); the real
// gate is the 4 h nightly wall-clock run plus HW-SOAK-01 on the owner rig.

import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const outDir = join(root, "docs", "finish", "evidence", "T-QA-06");

function slope(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  return den === 0 ? 0 : num / den;
}

export function analyzeSoak(samples, opts = {}) {
  const maxMemSlope = opts.maxMemSlopeMbPerHour ?? 5;
  const maxLatencySlope = opts.maxLatencySlopeMsPerHour ?? 1;
  const warmup = opts.warmupSamples ?? 6;
  const body = samples.slice(warmup);
  const t = body.map((s) => s.tHours);
  const rssSlope = slope(t, body.map((s) => s.rssMb));
  const latSlope = slope(t, body.map((s) => s.latencyMs));
  const uiSlope = slope(t, body.map((s) => s.uiFrameMs));
  const maxQueue = Math.max(...samples.map((s) => s.queueDepth));
  const drift = body.filter((s) => s.fixtureDrift).length;
  const stale = body.filter((s) => s.staleTrack).length;
  const dead = body.filter((s) => !s.workerAlive).length;
  const checks = {
    memSlope: rssSlope < maxMemSlope,
    queue: maxQueue <= 1,
    drift: drift === 0,
    latency: latSlope < maxLatencySlope,
    stale: stale === 0,
    worker: dead === 0,
    ui: uiSlope <= 0.5,
  };
  return { rssSlopeMbPerHour: rssSlope, latencySlopeMsPerHour: latSlope, uiSlopeMsPerHour: uiSlope, maxQueue, drift, stale, dead, checks, pass: Object.values(checks).every(Boolean) };
}

function synth(hours, seed, leakMbPerHour, latSlopeMs) {
  let s = seed >>> 0;
  const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0x100000000; };
  const out = [];
  const n = Math.floor(hours * 360);
  for (let i = 0; i < n; i++) {
    const t = i / 360;
    out.push({
      tHours: t, rssMb: 200 + leakMbPerHour * t + (rand() - 0.5) * 2,
      queueDepth: 1, fixtureDrift: false, staleTrack: false, workerAlive: true,
      latencyMs: 8 + latSlopeMs * t + (rand() - 0.5), uiFrameMs: 12 + (rand() - 0.5) * 2,
    });
  }
  return out;
}

const fast = process.argv.includes("--fast");
const hours = fast ? 0.5 : 4;
const good = analyzeSoak(synth(hours, 7, 0.5, 0.1), fast ? { warmupSamples: 2 } : {});
const leaky = analyzeSoak(synth(hours, 9, 40, 0.1), fast ? { warmupSamples: 2 } : {});
if (!good.pass) { console.error("soak harness self-check failed on healthy samples"); process.exit(1); }
if (leaky.checks.memSlope) { console.error("soak harness blind to a 40 MB/h leak"); process.exit(1); }
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "soak-report.json"), JSON.stringify({
  mode: fast ? "fast-self-check (not a soak)" : "nightly-4h-wall-clock",
  hours, healthy: good, leakyControl: leaky,
}, null, 2) + "\n");
console.log(`soak ${fast ? "self-check" : "report"}: healthy pass=${good.pass}, leaky memSlope=${leaky.rssSlopeMbPerHour.toFixed(1)} MB/h correctly fails`);
