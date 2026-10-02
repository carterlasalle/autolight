#!/usr/bin/env node
// License check (T-TRU-10): Yarn deps via license-checker, Python via
// pip-licenses, hand list for FFmpeg/uv/Python/weights. Denylist fails.
// Also asserts rkbx_link is never a dependency and no Skip-BART/SeqLight
// file, weight, or dataset entered the tree (spec 112).
//
// Usage:
//   node tools/license-check.mjs            check and print the JSON report
//   node tools/license-check.mjs --self-test  run the offline logic checks
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Denylist: GPL, AGPL, unlicensed. LGPL is NOT denied (OD-08 may bundle the
// LGPL fpcalc binary; FFmpeg ships as LGPL). "unknown" counts as unlicensed.
const DENY_RE = [/agpl/i, /\bgpl(?!l)/i, /^unlicensed$/, /^unknown$/];

function normLicense(raw) {
  const s = String(raw ?? "").trim();
  if (!s || /^see license/i.test(s)) return "UNLICENSED";
  return s;
}

function denied(licenseField) {
  const norm = normLicense(licenseField);
  if (norm === "UNLICENSED" || /^unknown$/i.test(norm)) return true;
  const parts = String(norm).split(/[;,|/()]+/).map((s) => s.trim()).filter(Boolean);
  const toks = parts.length ? parts : [String(norm)];
  return toks.some((t) => DENY_RE.some((re) => re.test(t)));
}

function readJson(p) {
  return JSON.parse(readFileSync(p, "utf8"));
}

// ---------------------------------------------------------------------------
// Yarn: license-checker (devDep bin) first, `yarn licenses list` fallback.

function parseConverterRows(rows) {
  const map = {};
  for (const r of rows) {
    if (!Array.isArray(r) || r.length < 3) continue;
    const key = `${r[0]}@${r[1]}`;
    if (!map[key]) map[key] = { name: r[0], version: r[1], licenses: r[2] };
  }
  return map;
}

function yarnLicenses() {
  try {
    const out = execFileSync("yarn", ["dlx", "license-checker-rseidelsohn", "--json", "--start", "."], {
      cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    });
    const parsed = JSON.parse(out);
    const map = {};
    for (const [key, v] of Object.entries(parsed)) {
      const at = key.lastIndexOf("@");
      map[key] = { name: key.slice(0, at), version: key.slice(at + 1), licenses: v.licenses };
    }
    return map;
  } catch (e1) {
    const out = execFileSync("yarn", ["dlx", "license-checker-rseidelsohn", "--json", "--summary", "--start", "."], {
      cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    });
    const rows = [];
    for (const line of out.split("\n")) {
      const t = line.trim();
      if (!t.startsWith("{")) continue;
      try {
        const j = JSON.parse(t);
        if (j.type === "table" && Array.isArray(j.data?.body)) rows.push(...j.data.body);
      } catch { /* ignore non-JSON progress lines */ }
    }
    return parseConverterRows(rows);
  }
}

// ---------------------------------------------------------------------------
// pip: pip-licenses runs in a uv overlay so no pyproject edit is required
// (the overlay shares the synced project venv, so it sees project deps).

function pipLicenses() {
  const out = execFileSync(
    "uv",
    ["run", "--project", "analysis", "--with", "pip-licenses", "pip-licenses", "--format=json"],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  return JSON.parse(out);
}

// ---------------------------------------------------------------------------
// Hand list: things the scanners cannot see (bundled binaries, runtimes,
// model weights). Versions are pinned here until T-OPS-05 bundles them.

function handList() {
  return [
    { name: "FFmpeg", kind: "bundled binary", license: "LGPL-2.1-or-later (unmodified binary; T-OPS-05 bundles it)", version: "system (brew/choco today)" },
    { name: "uv", kind: "bundled binary", license: "MIT OR Apache-2.0", version: "pinned by astral-sh/setup-uv" },
    { name: "Python 3.12", kind: "runtime", license: "PSF-2.0", version: "3.12 (setup-python)" },
    { name: "Node.js 22 (Electron bundles its own)", kind: "runtime", license: "MIT", version: "engines >=22.12" },
    { name: "all-in-one-infer weights", kind: "model weights", license: "UNLICENSED until owner decides (OD-09); not bundled today", version: "not bundled" },
    { name: "beat-this weights", kind: "model weights", license: "UNLICENSED until owner decides (OD-09); not bundled today", version: "not bundled" },
  ];
}

// ---------------------------------------------------------------------------
// rkbx_link: never a dependency. Scan every manifest, then the installed
// environments reported by the license tools.

function manifestRkbxScan(dir0 = root) {
  const hits = [];
  const walk = (dir) => {
    for (const n of readdirSync(dir)) {
      if (n === "node_modules" || n === "dist" || n === ".git") continue;
      const p = join(dir, n);
      let st;
      try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) { walk(p); continue; }
      if (n !== "package.json") continue;
      let j;
      try { j = readJson(p); } catch { continue; }
      for (const section of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
        for (const name of Object.keys(j[section] ?? {})) {
          if (/rkbx[_-]?link/i.test(name)) hits.push(`${p}: ${section}.${name}`);
        }
      }
    }
  };
  walk(dir0);
  return hits;
}

function installedRkbxScan(yarnMap, pipRows) {
  const names = [
    ...Object.keys(yarnMap ?? {}),
    ...(pipRows ?? []).map((p) => p.Name ?? p.name ?? ""),
  ];
  return names.filter((n) => /rkbx[_-]?link/i.test(n));
}

// ---------------------------------------------------------------------------
// Skip-BART / SeqLight tripwire (spec 112): no file, weight, or dataset from
// the unlicensed 2026 Skip-BART or SeqLight repos may enter the tree. Docs
// prose may cite them as research; vendored files may not.

function tripwireScan(dir0 = root) {
  const hits = [];
  const walk = (dir) => {
    for (const n of readdirSync(dir)) {
      if (n === "node_modules" || n === "dist" || n === ".git" || n === ".venv" || n === "__pycache__") continue;
      const p = join(dir, n);
      let st;
      try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) { walk(p); continue; }
      const rel = p.slice(dir0.length + 1);
      if (/skip[_-]?bart|seq[_-]?light/i.test(n)) { hits.push(rel); continue; }
      if (/\.(pt|pth|bin|safetensors|onnx|ckpt|weights)$/i.test(n)) {
        let head = "";
        try { head = readFileSync(p, "utf8").slice(0, 400); } catch { head = ""; }
        if (/skip[_-]?bart|seq[_-]?light/i.test(head)) hits.push(rel);
      }
    }
  };
  walk(dir0);
  return hits.filter((h) => !h.startsWith("docs/finish/"));
}

// ---------------------------------------------------------------------------
// Self-test: offline logic checks (the CI run exercises the exec paths).

function selfTest() {
  let bad = 0;
  const assert = (cond, msg) => { if (!cond) { console.error(`self-test FAIL: ${msg}`); bad++; } };
  assert(!denied("MIT"), "MIT must pass");
  assert(!denied("ISC"), "ISC must pass");
  assert(denied("GPL-3.0"), "GPL-3.0 must be denied (planted GPL dep)");
  assert(denied("GPL-2.0-only"), "GPL-2.0-only must be denied");
  assert(denied("AGPL-3.0"), "AGPL-3.0 must be denied");
  assert(!denied("LGPL-2.1-or-later"), "LGPL must pass (FFmpeg, fpcalc)");
  assert(denied("UNLICENSED"), "UNLICENSED must be denied");
  assert(denied("UNKNOWN"), "UNKNOWN must be denied");
  assert(denied(""), "empty license must be denied");
  assert(!denied("MIT OR Apache-2.0"), "MIT OR Apache-2.0 must pass (uv)");

  const tmp = mkdtempSync(join(tmpdir(), "al-license-selftest-"));
  try {
    writeFileSync(join(tmp, "package.json"), JSON.stringify({
      dependencies: { "rkbx_link-osx": "1.0.0" },
    }));
    writeFileSync(join(tmp, "skip-bart-weights.safetensors"), "seqlight model header bytes");
    writeFileSync(join(tmp, "benign.txt"), "plain text");
    const rkbx = manifestRkbxScan(tmp);
    assert(rkbx.length === 1 && /rkbx_link/.test(rkbx[0]), `planted rkbx_link manifest not detected: ${JSON.stringify(rkbx)}`);
    const trip = tripwireScan(tmp);
    assert(trip.length === 1 && trip[0] === "skip-bart-weights.safetensors", `planted Skip-BART weight not detected: ${JSON.stringify(trip)}`);
    rmSync(tmp, { recursive: true, force: true });
  } catch (e) {
    rmSync(tmp, { recursive: true, force: true });
    assert(false, `self-test threw: ${String(e)}`);
  }
  if (bad > 0) { console.error(`license-check self-test: ${bad} failure(s)`); process.exit(1); }
  console.log("license-check self-test: OK (denylist incl. planted GPL, rkbx_link manifest, Skip-BART weight)");
  process.exit(0);
}

if (process.argv.includes("--self-test")) selfTest();

// ---------------------------------------------------------------------------

let failures = 0;
const fail = (m) => { console.error(`license-check FAIL: ${m}`); failures++; };

let yarnMap = {};
try {
  yarnMap = yarnLicenses();
} catch (e) {
  fail(`yarn license scan failed (run yarn install first): ${String(e).split("\n")[0]}`);
}
for (const [key, v] of Object.entries(yarnMap)) {
  if (denied(normLicense(v.licenses))) fail(`yarn ${key} license=${JSON.stringify(v.licenses)}`);
}

let pipRows = [];
try {
  pipRows = pipLicenses();
} catch (e) {
  fail(`pip-licenses failed (run uv sync --project analysis --frozen --all-groups first): ${String(e).split("\n")[0]}`);
}
// First-party workspace package: its license comes from the repo, not PyPI metadata.
const FIRST_PARTY_PIP = new Set(["autolight-analysis"]);
// Metadata-gap allowlist: packages whose upstream license is known but whose
// PyPI metadata pip-licenses reports as UNKNOWN. Each entry names the real
// license and where it was verified. Keep this list to entries verified
// against the upstream project page or license file.
const KNOWN_LICENSE = new Map([
  ["cuda-toolkit", "NVIDIA proprietary EULA (CUDA Toolkit EULA; nvidia.com, torch CUDA wheel dependency; not GPL/AGPL)"],
]);
for (const p of pipRows) {
  const name = p.Name ?? p.name ?? "?";
  if (FIRST_PARTY_PIP.has(String(name).toLowerCase())) continue;
  if (KNOWN_LICENSE.has(String(name).toLowerCase())) continue;
  const lic = p.License ?? p.license ?? "";
  if (denied(normLicense(lic))) fail(`pip ${name} license=${JSON.stringify(lic)}`);
}

for (const h of handList()) {
  if (denied(normLicense(h.license))) fail(`hand-list ${h.name} license=${JSON.stringify(h.license)}`);
}

for (const h of manifestRkbxScan()) fail(`rkbx_link declared: ${h}`);
for (const n of installedRkbxScan(yarnMap, pipRows)) fail(`rkbx_link installed: ${n}`);
for (const h of tripwireScan()) fail(`unlicensed Skip-BART/SeqLight artifact: ${h}`);

const report = {
  generated: new Date().toISOString().slice(0, 10),
  yarn: Object.values(yarnMap).map((v) => ({ name: v.name, version: v.version, license: normLicense(v.licenses) })),
  pip: pipRows.map((p) => {
    const nm = String(p.Name ?? p.name ?? "");
    const known = KNOWN_LICENSE.get(nm.toLowerCase());
    return { name: p.Name ?? p.name, version: p.Version ?? p.version, license: known ?? normLicense(p.License ?? p.license) };
  }),
  hand: handList(),
  policy: { denylist: ["GPL", "AGPL", "unlicensed", "unknown"], rkbx_link: "never a dependency", skipBartSeqLight: "no files, weights, or datasets (research inspiration only)" },
};
process.stdout.write(JSON.stringify(report, null, 2) + "\n");

if (failures > 0) { console.error(`license-check: ${failures} failure(s)`); process.exit(1); }
console.error(`license-check: OK (${report.yarn.length} yarn, ${report.pip.length} pip, ${report.hand.length} hand-listed)`);