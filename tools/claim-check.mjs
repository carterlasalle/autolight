#!/usr/bin/env node
// Claim check (T-TRU-05): sentences in README/docs claiming supports,
// implements, works with, or verified must reference a capability ID.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
const yaml = readFileSync("capabilities.yaml", "utf8");
const ids = new Set([...yaml.matchAll(/^- id: (\S+)/gm)].map((m) => m[1]));
function md(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    const st = statSync(p);
    if (st.isDirectory()) { if (n !== "finish" && n !== "node_modules") md(p, out); }
    else if (n.endsWith(".md") && n !== "SPEC.MD") out.push(p);
  }
  return out;
}
const files = ["README.md", "CONTRIBUTING.md", "docs/architecture.md", "docs/govee.md",
  "docs/qualification.md", "docs/rekordbox-protocol.md", "docs/serato-protocol.md",
  "docs/show-planner.md", "docs/track-model.md", "docs/troubleshooting.md",
  "docs/room-mapping.md", "docs/config-reference.md"].filter((f) => {
  try { readFileSync(f); return true; } catch { return false; }
});
let bad = 0;
for (const f of files) {
  const text = readFileSync(f, "utf8");
  // skip generated capability block
  const clean = text.replace(/<!-- capabilities:start -->[\s\S]*?<!-- capabilities:end -->/g, "");
  for (const m of clean.matchAll(/[^.]*\b(supports|implements|works with|verified)\b[^.]*\./gi)) {
    const sentence = m[0];
    if (![...ids].some((id) => sentence.includes(id))) {
      console.error(`${f}: unlinked claim: ${sentence.trim().slice(0, 120)}`);
      bad++;
    }
  }
}
if (bad > 0) { console.error(`claim-check: ${bad} unlinked claims`); process.exit(1); }
console.log("claim-check: OK (every claim links a capability ID)");
