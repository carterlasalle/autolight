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
// LGPL fpcalc binary; FFmpeg ships as LGPL). "unknown" counts as unlicensed,
// as does NOASSERTION (normalization found nothing to assert).
const DENY_RE = [/agpl/i, /\bgpl(?!l)/i, /^unlicensed\b/i, /^unknown\b/i, /^noassertion$/i];

// SPDX normalization: scanner/hand-list free text becomes an SPDX expression
// (or LicenseRef- for first-party/proprietary items) so allow/deny tooling
// can compare exactly instead of relying on ad-hoc tokenization. Provenance
// remarks stay in a separate `note` field, never inside the license string.
const SPDX_ALIASES = new Map([
  ["mit license", "MIT"],
  ["isc license (iscl)", "ISC"],
  ["python software foundation license", "PSF-2.0"],
  ["bsd license", "BSD-3-Clause"],
  ["bsd", "BSD-3-Clause"],
  ["apache software license", "Apache-2.0"],
  ["apache 2.0", "Apache-2.0"],
  ["apache license 2.0", "Apache-2.0"],
  ["zlib/libpng", "Zlib"],
  ["mozilla public license 2.0 (mpl 2.0)", "MPL-2.0"],
]);

function spdxLicense(raw) {
  const s = String(raw ?? "").trim();

  if (!s || /^see license/i.test(s)) return { license: "NOASSERTION", note: `unresolved scanner text: ${s || "(empty)"}` };
  const m = /^(.+?)\s*\(([^()]*)\)\s*$/.exec(s);
  const alias = SPDX_ALIASES.get(s.toLowerCase());

  if (alias) return { license: alias };

  if (m && SPDX_ALIASES.get(m[1].trim().toLowerCase())) {
    return { license: SPDX_ALIASES.get(m[1].trim().toLowerCase()), note: m[2].trim() };
  }

  return { license: s };
}

function normLicense(raw) {
  return spdxLicense(raw).license;
}

function denied(licenseField) {
  const norm = normLicense(licenseField);

  if (norm === "UNLICENSED" || /^unknown$/i.test(norm)) return true;
  // An OR-choice is denied only when every arm is denied: the distributor
  // picks the permissive arm (node-forge ships BSD-3-Clause OR GPL-2.0).
  const arms = String(norm).split(/\s+OR\s+/i);

  if (arms.length > 1) return arms.every((arm) => denied(arm));
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
  // Prefer the workspace-installed bin (offline, pinned): `yarn dlx` hits
  // the network and fails under Yarn 4's linker here, which used to fail
  // open into an empty inventory.
  const attempts = [
    () => execFileSync("node", ["node_modules/.bin/license-checker-rseidelsohn", "--json", "--start", "."], {
      cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    }),
    () => execFileSync("yarn", ["dlx", "license-checker-rseidelsohn", "--json", "--start", "."], {
      cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    }),
  ];

  const errors = [];

  for (const run of attempts) {
    try {
      const out = run();
      const parsed = JSON.parse(out);
      const map = {};

      for (const [key, v] of Object.entries(parsed)) {
        const at = key.lastIndexOf("@");
        map[key] = { name: key.slice(0, at), version: key.slice(at + 1), licenses: v.licenses };
      }

      if (Object.keys(map).length > 0) return map;
      errors.push("scan returned no packages");
    } catch (e) {
      errors.push(String(e).split("\n")[0]);
    }
  }

  try {
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

    const map = parseConverterRows(rows);

    if (Object.keys(map).length > 0) return map;
  } catch (e) {
    errors.push(String(e).split("\n")[0]);
  }

  throw new Error(`all yarn license scans failed: ${errors.join(" | ")}`);
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
    { name: "FFmpeg", kind: "bundled binary", license: "LGPL-2.1-or-later", note: "unmodified binary; T-OPS-05 vendors it", version: "system (brew/choco today)" },
    { name: "uv", kind: "bundled binary", license: "MIT OR Apache-2.0", version: "0.9.4 (pinned in apps/desktop/scripts/fetch-vendor.mjs; astral-sh/setup-uv in CI)" },
    { name: "Python 3.12", kind: "runtime", license: "PSF-2.0", version: "3.12 (setup-python)" },
    { name: "Node.js 22 (Electron bundles its own)", kind: "runtime", license: "MIT", version: "engines >=22.12" },
    { name: "all-in-one-infer weights", kind: "model weights", license: "UNLICENSED until owner decides (OD-09); not bundled today", note: "vendor publishes no license; nothing is bundled or fetched", version: "not bundled", acknowledged: "vendor publishes no license; nothing is bundled or fetched (OD-09 pending)" },
    { name: "beat-this weights", kind: "model weights", license: "UNLICENSED until owner decides (OD-09); not bundled today", note: "vendor publishes no license; nothing is bundled or fetched", version: "not bundled", acknowledged: "vendor publishes no license; nothing is bundled or fetched (OD-09 pending)" },
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
  assert(!denied("(BSD-3-Clause OR GPL-2.0)"), "OR-choice with a permissive arm must pass (node-forge)");
  assert(denied("(GPL-2.0 OR GPL-3.0)"), "OR-choice with every arm denied must fail");
  assert(denied("UNLICENSED"), "UNLICENSED must be denied");
  assert(denied("Unlicensed"), "Unlicensed mixed case must be denied (token path)");
  assert(denied("UNLICENSED (weights, not bundled)"), "tokenized UNLICENSED phrase must be denied (case-insensitive tokens)");
  assert(denied("UNLICENSED until owner decides (OD-09); not bundled today"), "UNLICENSED phrase with suffix must be denied (word-boundary prefix)");
  assert(denied("UNKNOWN"), "UNKNOWN must be denied");
  assert(denied(""), "empty license must be denied");
  assert(!denied("MIT OR Apache-2.0"), "MIT OR Apache-2.0 must pass (uv)");
  assert(spdxLicense("Python Software Foundation License").license === "PSF-2.0", "PSF free text normalizes to SPDX");
  assert(spdxLicense("MIT License").license === "MIT", "MIT free text normalizes to SPDX");
  assert(spdxLicense("BSD License").license === "BSD-3-Clause", "BSD free text normalizes to SPDX");
  assert(spdxLicense("").license === "NOASSERTION", "empty license normalizes to NOASSERTION");
  assert(denied(spdxLicense("").license), "NOASSERTION must be denied");
  assert(spdxLicense("LGPL-2.1-or-later").license === "LGPL-2.1-or-later", "SPDX input passes through unchanged");

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

// Denylist hits that are recorded, explained, and accepted (kept visible in
// the report and the summary instead of failing silently or hard).
const acknowledged = [];

// First-party workspace packages: their license comes from the repo, not
// registry metadata (license-checker/pip-licenses report UNKNOWN for
// packages without published license metadata).
const FIRST_PARTY_PIP = new Set(["autolight-analysis"]);

const FIRST_PARTY_YARN_PREFIX = "@autolight/";

const FIRST_PARTY_LICENSE = "LicenseRef-FirstParty-Proprietary";

const FIRST_PARTY_NOTE = "first-party workspace package (analysis/pyproject.toml); license is the repository's own, not PyPI metadata";

const fail = (m) => { console.error(`license-check FAIL: ${m}`); failures++; };

let yarnMap = {};

try {
  yarnMap = yarnLicenses();
} catch (e) {
  fail(`yarn license scan failed (run yarn install first): ${String(e).split("\n")[0]}`);
}

// An empty yarn inventory is a failed scan, not a clean pass: without it the
// gate would approve every JS/Electron dependency vacuously.
if (Object.keys(yarnMap).length === 0) {
  fail("yarn license scan returned no packages (expected the workspace dependency inventory)");
}

for (const [key, v] of Object.entries(yarnMap)) {
  if (String(v.name).startsWith(FIRST_PARTY_YARN_PREFIX)) continue;

  if (denied(normLicense(v.licenses))) fail(`yarn ${key} license=${JSON.stringify(v.licenses)}`);
}

let pipRows = [];

try {
  pipRows = pipLicenses();
} catch (e) {
  fail(`pip-licenses failed (run uv sync --project analysis --frozen --all-groups first): ${String(e).split("\n")[0]}`);
}


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
  if (!denied(normLicense(h.license))) continue;

  if (h.acknowledged) {
    acknowledged.push(`${h.name}: ${h.acknowledged}`);
    continue;
  }

  fail(`hand-list ${h.name} license=${JSON.stringify(h.license)}`);
}

for (const h of manifestRkbxScan()) fail(`rkbx_link declared: ${h}`);

for (const n of installedRkbxScan(yarnMap, pipRows)) fail(`rkbx_link installed: ${n}`);

for (const h of tripwireScan()) fail(`unlicensed Skip-BART/SeqLight artifact: ${h}`);

const report = {
  schema_version: 1,
  generated: new Date().toISOString().slice(0, 10),
  yarn: Object.values(yarnMap).map((v) => {
    if (String(v.name).startsWith(FIRST_PARTY_YARN_PREFIX)) {
      return { name: v.name, version: v.version, license: FIRST_PARTY_LICENSE, note: "first-party workspace package (packages/*); license is the repository's own, not registry metadata" };
    }

    const { license, note } = spdxLicense(v.licenses);
    const entry = { name: v.name, version: v.version, license };

    if (note !== undefined) entry.note = note;

    return entry;
  }),
  pip: pipRows.map((p) => {
    const nm = String(p.Name ?? p.name ?? "");

    if (FIRST_PARTY_PIP.has(nm.toLowerCase())) {
      return { name: p.Name ?? p.name, version: p.Version ?? p.version, license: FIRST_PARTY_LICENSE, note: FIRST_PARTY_NOTE };
    }

    const known = KNOWN_LICENSE.get(nm.toLowerCase());

    if (known !== undefined) return { name: p.Name ?? p.name, version: p.Version ?? p.version, license: known };
    const { license, note } = spdxLicense(p.License ?? p.license);
    const entry = { name: p.Name ?? p.name, version: p.Version ?? p.version, license };

    if (note !== undefined) entry.note = note;

    return entry;
  }),
  hand: handList(),
  policy: {
    denylist: ["GPL", "AGPL", "unlicensed", "unknown", "NOASSERTION"],
    acknowledged_denylist_exceptions: acknowledged,
    forbidden_dependency_rekordbox_link: "never a dependency",
    unlicensed_model_guard_skip_bart_seq_light: "no files, weights, or datasets (research inspiration only)",
    // LGPL is not denied, but it is not unconditioned either: the library
    // stays unmodified and its notices ship (FFmpeg static build, soxr,
    // fpcalc per OD-08); no derivative of the library itself is distributed.
    weak_copyleft_lgpl: "allowed unmodified with notices shipped; no derivative of the library is distributed (FFmpeg, soxr, fpcalc)",
  },
};

process.stdout.write(JSON.stringify(report, null, 2) + "\n");

if (failures > 0) { console.error(`license-check: ${failures} failure(s)`); process.exit(1); }

if (acknowledged.length > 0) console.error(`license-check: ${acknowledged.length} acknowledged denylist exception(s)`);

console.error(`license-check: OK (${report.yarn.length} yarn, ${report.pip.length} pip, ${report.hand.length} hand-listed)`);