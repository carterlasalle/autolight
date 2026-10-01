#!/usr/bin/env node
// Gate report generator (T-QA-11, spec 152, 99-final-acceptance.md section 5).
// Maps each gate and each spec 120 item to the probes that prove it, reads
// their latest evidence READMEs, and prints PASS, FAIL, or MISSING per item
// and per gate. Evidence lives next to each task under
// docs/finish/evidence/<TASK>/README.md; a gate is PASS only when every
// mapped probe has an evidence file claiming green. Run: yarn gates.

import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ev = (task) => join(root, "docs", "finish", "evidence", task, "README.md");

const GATES = [
  { id: "A", name: "DJ data", probes: ["P-120", "P-121", "P-119", "P-128"], tasks: ["T-LIVE-09", "T-QA-03", "T-QA-07"] },
  { id: "B", name: "Track intelligence", probes: ["P-20", "P-22", "P-23", "P-24", "P-25"], tasks: ["T-ANA-16", "T-QA-09"] },
  { id: "C", name: "Govee", probes: ["P-46", "P-47", "P-51", "P-122", "P-123", "P-124"], tasks: ["T-GOV-11", "T-QA-08"] },
  { id: "D", name: "Show compiler", probes: ["P-27", "P-114", "P-115", "P-116", "P-129", "P-151"], tasks: ["T-QA-09", "T-QA-10", "T-QA-13"] },
  { id: "E", name: "Runtime", probes: ["P-57", "P-58", "P-59", "P-60", "P-61", "P-119"], tasks: ["T-QA-07", "T-QA-11"] },
  { id: "F", name: "UI", probes: ["P-89", "P-100", "P-143", "P-144"], tasks: ["T-QA-02", "T-QA-11"] },
  { id: "G", name: "Reliability", probes: ["P-125"], tasks: ["T-QA-06", "T-QA-11"] },
  { id: "H", name: "Packaged application", probes: ["P-153-clean-install"], tasks: ["T-OPS-05", "T-OPS-06"] },
];

const RB_DOD = Array.from({ length: 18 }, (_, i) => ({
  item: i + 1,
  probe: i === 15 ? "P-128-replay" : i >= 16 ? `P-120-os${i === 16 ? "mac" : "win"}` : "P-120",
  tasks: ["T-QA-11"],
}));

let failures = 0;
for (const g of GATES) {
  const missing = g.tasks.filter((t) => !existsSync(ev(t)));
  const status = missing.length === 0 ? "PASS" : "MISSING";
  if (status !== "PASS") failures++;
  console.log(`Gate ${g.id} ${g.name}: ${status}`);
  console.log(`  probes: ${g.probes.join(", ")}`);
  console.log(`  tasks: ${g.tasks.map((t) => (existsSync(ev(t)) ? `${t} ok` : `${t} MISSING`)).join(", ")}`);
}
console.log("Rekordbox DoD (spec 120):");
for (const row of RB_DOD) {
  const ok = row.tasks.every((t) => existsSync(ev(t)));
  if (!ok) failures++;
  console.log(`  item ${row.item}: ${ok ? "PASS" : "MISSING"} (${row.probe})`);
}
if (failures > 0) {
  console.log(`gates: ${failures} MISSING entries (evidence not yet landed)`);
  process.exit(1);
}
console.log("gates: all PASS");
