#!/usr/bin/env node
// Goldens policy check (T-QA-10, probes P-127-goldens, P-129-no-self-write).
// Fails when any test writes into test-fixtures/goldens outside the update
// command: scans test sources for writeFileSync/writeFile targets under
// test-fixtures or *golden*. yarn golden:update --reason is the only writer.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function walk(dir, out = []) {
  let names = [];
  try { names = readdirSync(dir); } catch { return out; }
  for (const n of names) {
    if (n === "node_modules" || n === "dist" || n === ".venv") continue;
    const p = join(dir, n);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, out);
    else if (/\.test\.(ts|tsx)$/.test(n) || /\.journey\.ts$/.test(n)) out.push(p);
  }
  return out;
}

const files = [...walk(join(root, "packages")), ...walk(join(root, "apps"))];
let hits = 0;
for (const f of files) {
  const text = readFileSync(f, "utf8");
  for (const [i, line] of text.split("\n").entries()) {
    if (/writeFile(Sync)?\(/.test(line) && (/test-fixtures/.test(line) || /golden/i.test(line))) {
      // Allowed: writes to temp dirs in tests, and the golden-update script.
      if (/mkdtemp|tmpdir|test-results/.test(line)) continue;
      console.error(`${f}:${i + 1}: golden self-write: ${line.trim().slice(0, 100)}`);
      hits++;
    }
  }
}
// The update command itself must record reasons in the changelog.
const changelog = join(root, "test-fixtures", "goldens", "CHANGELOG.md");
let hasChangelog = false;
try { hasChangelog = readFileSync(changelog, "utf8").length > 0; } catch { hasChangelog = false; }
if (!hasChangelog) {
  // Missing golden dir is MISSING, not a policy violation yet: T-ANA-16 owns it.
  console.log("goldens changelog: MISSING (T-ANA-16 owns the golden dir)");
} else {
  console.log("goldens changelog: present");
}
if (hits > 0) { console.error(`goldens policy: ${hits} self-writes`); process.exit(1); }
console.log("goldens policy: no test writes into goldens outside yarn golden:update (S2)");
