#!/usr/bin/env node
// Forbidden-words check (T-TRU-06): fails on deferral language in production.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
const roots = ["packages", "apps/desktop/src", "apps/desktop/electron", "analysis/src"];
const exts = [".ts", ".tsx", ".py"];
const words = ["TODO", "FIXME", "ponytail", "stub", "placeholder", "mock", "future", "coming soon", "not yet", "phase 2"];
function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    const st = statSync(p);
    if (st.isDirectory()) { if (!n.includes("node_modules") && n !== "dist" && n !== "ui") walk(p, out); }
    else if (exts.some((e) => p.endsWith(e)) && !p.includes(".test.")) out.push(p);
  }
  return out;
}
let hits = 0;
for (const r of roots) {
  for (const f of walk(r)) {
    const text = readFileSync(f, "utf8");
    for (const w of words) {
      const re = new RegExp(`\\b${w}\\b`, "i");
      text.split("\n").forEach((line, i) => {
        if (re.test(line)) {
          if (f.includes("components/ui/")) return;
          if (line.includes("placeholder=")) return;
          console.error(`${f}:${i + 1}: ${w}`);
          hits++;
        }
      });
    }
  }
}
if (hits > 0) { console.error(`forbidden-words: ${hits} hits`); process.exit(1); }
console.log("forbidden-words: clean");
