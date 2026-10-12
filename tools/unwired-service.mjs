#!/usr/bin/env node
// Unwired-service check: every service getter with a start() method must be
// started from production boot, or be consumed somewhere outside its file.
// Found live 3x: analysis-supervisor (E_SUPERVISOR_NOT_STARTED, silent empty
// show), provider-manager start() vs pollOnce-only use (svc.ax stuck
// unreadable), identity/midi/show-host-supervisor/library getters with zero
// external callers. ast-grep cannot express cross-file "never called", so
// this script does the reference check directly.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const roots = ["apps/desktop/electron", "packages"];

const exts = [".ts", ".tsx"];

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    let st;

    try { st = statSync(p); } catch { continue; }

    if (st.isDirectory()) {
      if (!n.includes("node_modules") && n !== "dist" && n !== "ui") walk(p, out);
    } else if (exts.some((e) => p.endsWith(e)) && !p.includes(".test.")) out.push(p);
  }

  return out;
}

// Boot entry points: calls here count as wired.
const BOOT_FILES = [
  "apps/desktop/electron/main.ts",
  "apps/desktop/electron/show-service.ts",
];

const files = [];

for (const r of roots) {
  try { files.push(...walk(r)); } catch { /* root missing */ }
}

const texts = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));

// Service getters: exported get*/create*/open* factory functions in service
// modules. create*/open* variants (createIpc, openStorageService) are the
// entry points for services without get* getters.
const getters = [];

for (const [f, text] of texts) {
  if (!/services\//.test(f)) continue;

  for (const m of text.matchAll(/export function ((?:get|create|open)[A-Za-z]+)\(/g)) {
    getters.push({ getter: m[1], file: f });
  }
}

let failures = 0;

for (const { getter, file } of getters) {
  // Count references outside the defining file (excluding tests).
  let refs = 0;

  for (const [f, text] of texts) {
    if (f === file || f.includes(".test.")) continue;
    const hits = text.match(new RegExp(`\\b${getter}\\b`, "g"));

    if (hits) refs += hits.length;
  }

  // Boot refs specifically (main.ts / show-service.ts).
  let bootRefs = 0;

  for (const b of BOOT_FILES) {
    const text = texts.get(b) ?? "";
    const hits = text.match(new RegExp(`\\b${getter}\\b`, "g"));

    if (hits) bootRefs += hits.length;
  }

  if (refs === 0) {
    console.log(`WARN ${file}: ${getter} has zero callers outside its file (dead service — wire it or delete it)`);
  } else if (bootRefs === 0 && /Service|Supervisor|Manager/.test(file)) {
    // Has callers but none at boot: flag only if the module defines start().
    const own = texts.get(file) ?? "";

    if (/start\(\):/.test(own) || /export function start/.test(own)) {
      console.error(`${file}: ${getter} has callers but none in boot (main.ts/show-service.ts) — confirm its start() runs`);
      failures++;
    }
  }
}

// Special case: the AX path must stay live. Topology (AL-FLOW-001 fix):
// pollAxCommand (show-service) polls through the manager's pollOnce() and
// writes svc.ax, serving both the bridge and the renderer cursor. The
// manager's start() 1Hz loop is intentionally NOT run at boot: latest()
// has no consumers, prolink runs via startProlink(), and composite boot is
// test-only. Demanding start() would wire a readerless loop.
{
  const show = texts.get("apps/desktop/electron/show-service.ts") ?? "";
  const live = show.includes("getProviderManager().pollOnce()") && show.includes("svc.ax = readings.map");
  if (!live) {
    console.error("apps/desktop/electron/show-service.ts: pollAxCommand must poll through getProviderManager().pollOnce() and write svc.ax (single AX authority; see AL-FLOW-001)");
    failures++;
  }
}

if (failures > 0) {
  console.error(`\nunwired-service: ${failures} failure(s)`);
  process.exit(1);
}

console.log("unwired-service: clean");
