#!/usr/bin/env node
// Mutation safety-critical list check (T-TRU-08). Fails on missing modules or pending entries.
import { existsSync, readFileSync } from "node:fs";

const list = JSON.parse(readFileSync("tools/mutation/critical.json", "utf8"));
const missing = list.critical.filter((e) => e.status === "present" && !existsSync(e.module));
if (missing.length) {
  console.error("critical.json lists modules that do not exist:");
  for (const m of missing) console.error(`  ${m.id} -> ${m.module}`);
  process.exit(1);
}
const pending = list.critical.filter((e) => e.status === "pending");
if (pending.length) {
  console.error(`critical.json has pending entries (owned by ${[...new Set(pending.map((p) => p.ownerTask))].join(", ")}): ${pending.map((p) => p.id).join(", ")}`);
  process.exit(1);
}
console.log("mutation-critical: every listed module exists and nothing is pending");
