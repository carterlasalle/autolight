#!/usr/bin/env node
// Capability manifest check (T-TRU-05): README table matches capabilities.yaml,
// no PASS without evidence, statuses use the vocabulary.
import { readFileSync } from "node:fs";
const VALID = new Set(["PASS", "IMPLEMENTED_UNQUALIFIED", "PARTIAL", "FAIL", "UNAVAILABLE_ON_THIS_DEVICE", "MISSING"]);
const yaml = readFileSync("capabilities.yaml", "utf8");
const ids = [...yaml.matchAll(/^- id: (\S+)/gm)].map((m) => m[1]);
const statuses = [...yaml.matchAll(/^  status: (\S+)/gm)].map((m) => m[1]);
let bad = 0;
for (const s of statuses) if (!VALID.has(s)) { console.error(`bad status: ${s}`); bad++; }
const readme = readFileSync("README.md", "utf8");
for (const id of ids) {
  if (!readme.includes(`(${id})`)) { console.error(`README table missing capability: ${id}`); bad++; }
}
if (statuses.includes("PASS")) { console.error("PASS claimed: simulator runs never qualify hardware"); bad++; }
if (bad > 0) { console.error(`capabilities-check: ${bad} problems`); process.exit(1); }
console.log(`capabilities-check: OK (${ids.length} capabilities, 0 PASS)`);
