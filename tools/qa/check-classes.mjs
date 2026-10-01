#!/usr/bin/env node
// Test-class enforcement (T-QA-01, spec 126, probe P-126-classes).
// Counts tests per class by file naming plus required-suite artifacts, and
// fails when any class has zero or a required suite artifact is missing.
// Prints the unique test count (S18). Run: node tools/qa/check-classes.mjs.

import { readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
// (root resolved above: tools/qa -> tools -> repo root)

function walk(dir, out = []) {
  let names = [];
  try { names = readdirSync(dir); } catch { return out; }
  for (const n of names) {
    if (n === "node_modules" || n === "dist" || n === ".venv" || n === "__pycache__") continue;
    const p = join(dir, n);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, out);
    else if (/\.test\.(ts|tsx)$/.test(n) || /^test_.*\.py$/.test(n)) out.push(p);
    else if (/\.journey\.ts$/.test(n) || /\.spec\.ts$/.test(n)) out.push(p);
    else if (/fault-injection\.(ts|tsx)$/.test(n)) out.push(p);
  }
  return out;
}

function classify(f) {
  if (/\.property\.test\.ts$/.test(f)) return "property";
  if (/test_.*_golden\.py$/.test(f) || /golden/.test(f)) {
    if (f.includes("analysis") || f.endsWith("test_analysis_golden.py")) return "analysis golden";
    if (f.includes("planner")) return "planner golden";
    return "renderer golden";
  }
  if (/apps\/desktop\/(e2e\/.*\.spec\.ts|journeys\/.*\.journey\.ts)$/.test(f)) return "desktop E2E";
  if (/replay/i.test(f)) return "protocol-replay";
  // SecFaultDocs T-QA-04 scope: the fault-injection transport plus its test.
  if (/fault-injection/i.test(f)) return "fault injection";
  if (/simulator|fault/i.test(f)) {
    if (/fault/i.test(f)) return "fault injection";
    return "device simulator";
  }
  if (/perf/i.test(f)) return "performance";
  if (/soak/i.test(f)) return "soak";
  if (/schema|contract/i.test(f)) return "schema";
  return "unit";
}

const files = [
  ...walk(join(root, "packages")),
  ...walk(join(root, "apps", "desktop", "e2e")),
  ...walk(join(root, "apps", "desktop", "journeys")),
  ...walk(join(root, "apps", "desktop", "src")),
  ...walk(join(root, "apps", "desktop", "electron")),
  ...walk(join(root, "analysis", "tests")),
];
const counts = {};
for (const f of files) {
  const c = classify(f);
  counts[c] = (counts[c] ?? 0) + 1;
}

const required = [
  ["performance", "docs/finish/evidence/T-QA-05/measurement.json", "T-QA-05 harness run"],
  ["soak", "docs/finish/evidence/T-QA-06/soak-report.json", "T-QA-06 nightly wall-clock run"],
  ["protocol-replay", "docs/finish/evidence/T-QA-03/README.md", "T-QA-03 harness over real fixtures"],
  ["desktop E2E", "apps/desktop/e2e/normal-night.spec.ts", "T-QA-02 suite incl. normal-night"],
  ["analysis golden", "docs/finish/evidence/T-ANA-16/README.md", "T-ANA-16 suite"],
  ["planner golden", "test-fixtures/analysis/planner-golden.json", "T-PLAN-15 suite"],
  ["renderer golden", "docs/finish/evidence/T-REND-06/README.md", "T-REND-06 suite"],
  ["device simulator", "docs/finish/evidence/T-QA-04/README.md", "T-QA-04 simulator suites"],
  ["fault injection", "docs/finish/evidence/T-QA-04/README.md", "T-QA-04 fault suites"],
];

const CLASSES = ["unit", "schema", "property", "protocol-replay", "analysis golden",
  "planner golden", "renderer golden", "device simulator", "fault injection",
  "desktop E2E", "performance", "soak"];

let failures = 0;
for (const c of CLASSES) {
  const n = counts[c] ?? 0;
  console.log(`${c}: ${n} file(s)`);
  if (n === 0) { console.error(`MISSING class: ${c}`); failures++; }
}
for (const [cls, artifact, what] of required) {
  const ok = existsSync(join(root, artifact));
  console.log(`${cls} suite artifact ${artifact}: ${ok ? "present" : "MISSING"} (${what})`);
  if (!ok) { console.error(`MISSING required suite: ${what}`); failures++; }
}
const unique = new Set(files).size;
console.log(`unique test files: ${unique} (S18)`);
if (failures > 0) { console.error(`class check: ${failures} missing`); process.exit(1); }
console.log("class check: all 12 classes present with required suites");
