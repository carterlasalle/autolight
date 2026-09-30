#!/usr/bin/env node
// docs/finish/tools/check-coverage.mjs
//
// Mechanical checks for the AutoLight finish plan. No dependencies.
// Run from the repository root:  node docs/finish/tools/check-coverage.mjs
// (CI runs it through `yarn truth`, task T-TRU-01.)
//
// Checks:
//  1. Every finding F-* in 01-findings-register.md (except F-X-*, which are
//     claims verified false or unverified) is referenced by at least one task
//     file (03, 04, wp*.md), every task named in its "Closed by" column
//     exists as a task heading, and each of those tasks mentions the finding.
//  2. Every task heading (### T-XXX-NN) appears on STATUS.md, and STATUS.md
//     names no task that does not exist.
//  3. Every task ID referenced anywhere in the plan exists as a heading.
//  4. Every task marked DONE-VERIFIED on STATUS.md has
//     docs/finish/evidence/<TASK-ID>/README.md; BLOCKED-HARDWARE needs a
//     runbook.md in the same folder; CLOSED-OWNER-DECLINED needs decision.md.
//  5. No em-dash (U+2014) in any Markdown file under docs/finish.
//  6. Every SPEC section 1 to 155 has a row in 02-conformance-matrix.md.
//  7. Every probe P-* referenced in the plan is defined in the matrix or in
//     the WP05 room probe table.
//  8. Decision switches DS-01..DS-NN are contiguous, each has a catalog row,
//     and every DS referenced exists.
//  9. Every hardware runbook HW-* referenced exists in the WP15 runbook table.
// 10. Every config key referenced in backticks exists in the 03 catalog.
//
// Exit code 0 when all checks pass, 1 otherwise. Output lists every problem.

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const planDir = join(here, "..");
const repoRoot = join(planDir, "..", "..");

const problems = [];
const fail = (msg) => problems.push(msg);

function listMarkdown(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...listMarkdown(p));
    else if (name.endsWith(".md")) out.push(p);
  }
  return out;
}

const read = (p) => readFileSync(p, "utf8");
const rel = (p) => relative(repoRoot, p);

const allDocs = listMarkdown(planDir);
const topDocs = readdirSync(planDir)
  .filter((n) => n.endsWith(".md"))
  .map((n) => join(planDir, n));
const taskFiles = topDocs.filter((p) => {
  const n = p.split(/[\\/]/).pop();
  return n.startsWith("wp") || n.startsWith("03-") || n.startsWith("04-");
});

// ---------------------------------------------------------------- tasks
const TASK_HEAD = /^### (T-[A-Z]+-\d{2})\b(.*)$/gm;
const tasks = new Map(); // id -> { file, title, body }
for (const file of taskFiles) {
  const text = read(file);
  const heads = [...text.matchAll(TASK_HEAD)];
  heads.forEach((m, i) => {
    const start = m.index;
    const end = i + 1 < heads.length ? heads[i + 1].index : text.length;
    const id = m[1];
    if (tasks.has(id)) fail(`Duplicate task heading ${id} in ${rel(file)} and ${rel(tasks.get(id).file)}`);
    tasks.set(id, { file, title: m[2].trim(), body: text.slice(start, end) });
  });
}
if (tasks.size === 0) fail("No task headings found. Is the script in docs/finish/tools?");

// Expand "T-BLE-01 to T-BLE-10" style ranges.
function expandTaskRefs(text) {
  const out = new Set();
  for (const m of text.matchAll(/\b(T-[A-Z]+-\d{2})\b/g)) out.add(m[1]);
  for (const m of text.matchAll(/\b(T-[A-Z]+)-(\d{2})\s+to\s+\1-(\d{2})\b/g)) {
    const prefix = m[1];
    const lo = Number(m[2]);
    const hi = Number(m[3]);
    for (let n = lo; n <= hi; n++) out.add(`${prefix}-${String(n).padStart(2, "0")}`);
  }
  return out;
}

// ---------------------------------------------------------------- findings
const registerPath = join(planDir, "01-findings-register.md");
const register = read(registerPath);
const FINDING_ROW = /^\| (F-[A-Z]+-\d{2}) \|(.*)\|\s*$/gm;
const findings = new Map(); // id -> closedBy text
for (const m of register.matchAll(FINDING_ROW)) {
  findings.set(m[1], m[2]);
}
if (findings.size === 0) fail("No findings parsed from 01-findings-register.md");

const taskFileText = taskFiles.map(read).join("\n");
for (const [id, closedBy] of findings) {
  if (id.startsWith("F-X-")) continue;
  if (!taskFileText.includes(id)) fail(`${id} is not referenced by any task file`);
  const closedByTasks = [...expandTaskRefs(closedBy)].filter((t) => tasks.has(t) || /^T-[A-Z]+-\d{2}$/.test(t));
  if (closedByTasks.length === 0) fail(`${id} names no task in "Closed by"`);
  for (const t of closedByTasks) {
    if (!tasks.has(t)) {
      fail(`${id} names ${t} in "Closed by", which has no task heading`);
      continue;
    }
    if (!tasks.get(t).body.includes(id)) fail(`${t} does not mention ${id} but is named as closing it`);
  }
}

// ---------------------------------------------------------------- STATUS.md
const statusPath = join(planDir, "STATUS.md");
if (!existsSync(statusPath)) {
  fail("docs/finish/STATUS.md is missing");
} else {
  const status = read(statusPath);
  const STATUS_ROW = /^\| (T-[A-Z]+-\d{2}) \|(.*)\|\s*$/gm;
  const statusRows = new Map();
  for (const m of status.matchAll(STATUS_ROW)) {
    const cells = m[2].split("|").map((c) => c.trim());
    statusRows.set(m[1], cells);
  }
  const VALID = new Set(["TODO", "IN-PROGRESS", "DONE-VERIFIED", "BLOCKED-HARDWARE", "BLOCKED-OWNER-DECISION", "CLOSED-OWNER-DECLINED"]);
  for (const id of tasks.keys()) if (!statusRows.has(id)) fail(`${id} is missing from STATUS.md`);
  for (const [id, cells] of statusRows) {
    if (!tasks.has(id)) fail(`STATUS.md lists ${id}, which has no task heading`);
    const st = cells.find((c) => VALID.has(c.replace(/`/g, "")));
    if (!st) { fail(`${id} on STATUS.md has no valid status (${[...VALID].join(", ")})`); continue; }
    const s = st.replace(/`/g, "");
    const evDir = join(planDir, "evidence", id);
    if (s === "DONE-VERIFIED" && !existsSync(join(evDir, "README.md")))
      fail(`${id} is DONE-VERIFIED but docs/finish/evidence/${id}/README.md does not exist`);
    if (s === "BLOCKED-HARDWARE" && !existsSync(join(evDir, "runbook.md")))
      fail(`${id} is BLOCKED-HARDWARE but docs/finish/evidence/${id}/runbook.md does not exist`);
    if (s === "CLOSED-OWNER-DECLINED" && !existsSync(join(evDir, "decision.md")))
      fail(`${id} is CLOSED-OWNER-DECLINED but docs/finish/evidence/${id}/decision.md does not exist`);
  }
  for (const id of findings.keys()) {
    if (id.startsWith("F-X-")) continue;
    if (!new RegExp(`\\b${id}\\b`).test(status)) fail(`${id} is missing from STATUS.md`);
  }
}

// ---------------------------------------------------------------- dangling task refs
for (const file of allDocs) {
  const text = read(file);
  for (const id of expandTaskRefs(text)) {
    if (!tasks.has(id)) fail(`${rel(file)} references ${id}, which has no task heading`);
  }
}

// ---------------------------------------------------------------- em-dash
for (const file of allDocs) {
  const lines = read(file).split("\n");
  lines.forEach((line, i) => {
    if (line.includes("—")) fail(`Em-dash in ${rel(file)}:${i + 1}`);
  });
}

// ---------------------------------------------------------------- spec sections in the matrix
const matrix = read(join(planDir, "02-conformance-matrix.md"));
const matrixSections = new Set();
for (const m of matrix.matchAll(/^\| ([0-9][0-9 ./A-Z]*?) \|/gm)) {
  const n = Number(m[1].split(/[^0-9]/)[0]);
  if (Number.isFinite(n)) matrixSections.add(n);
}
for (let s = 1; s <= 155; s++) if (!matrixSections.has(s)) fail(`SPEC section ${s} has no row in 02-conformance-matrix.md`);

// ---------------------------------------------------------------- probes
const probeDefs = new Set();
for (const m of matrix.matchAll(/`(P-[0-9A-Za-z.]+(?:-[a-z0-9.]+)*)`/g)) probeDefs.add(m[1]);
const wp05 = read(join(planDir, "wp05-room-and-venue.md"));
for (const m of wp05.matchAll(/^\s*\| `(P-ROOM-\d{2}-[a-z0-9-]+)` \|/gm)) probeDefs.add(m[1]);
// A reference may use the short form (P-56) of a defined probe (P-56-ui-freeze).
const shortForms = new Set([...probeDefs].map((p) => p.match(/^P-(ROOM-\d{2}|[0-9]+(?:\.[0-9]+)?)/)?.[0]).filter(Boolean));
for (const file of allDocs) {
  const text = read(file);
  for (const m of text.matchAll(/`(P-[0-9A-Za-z.]+(?:-[a-z0-9.]+)*)`/g)) {
    const p = m[1];
    if (probeDefs.has(p)) continue;
    const short = p.match(/^P-(ROOM-\d{2}|[0-9]+(?:\.[0-9]+)?)/)?.[0];
    if (short && shortForms.has(short)) continue;
    fail(`${rel(file)} references probe ${p}, which is not defined in the matrix or WP05`);
  }
}

// ---------------------------------------------------------------- decision switches
const cfg = read(join(planDir, "03-config-and-decisions.md"));
const dsRows = new Set([...cfg.matchAll(/^\| (DS-\d{2}) \|/gm)].map((m) => m[1]));
const dsNums = [...dsRows].map((d) => Number(d.slice(3))).sort((a, b) => a - b);
for (let i = 1; i <= (dsNums.at(-1) ?? 0); i++) {
  const id = `DS-${String(i).padStart(2, "0")}`;
  if (!dsRows.has(id)) fail(`Decision switch ${id} is missing from the 03 catalog (DS numbers must be contiguous)`);
}
for (const file of allDocs) {
  const text = read(file);
  for (const m of text.matchAll(/\b(DS-\d{2})\b/g)) {
    if (!dsRows.has(m[1])) fail(`${rel(file)} references ${m[1]}, which has no catalog row in 03`);
  }
}

// ---------------------------------------------------------------- hardware runbooks
const wp15 = read(join(planDir, "wp15-verification-qualification.md"));
const runbooks = new Set([...wp15.matchAll(/^\| `(HW-[A-Z]+(?:-[A-Z]+)*-\d{2})` \|/gm)].map((m) => m[1]));
for (const file of allDocs) {
  const text = read(file);
  for (const m of text.matchAll(/`(HW-[A-Z]+(?:-[A-Z]+)*-\d{2})`/g)) {
    if (!runbooks.has(m[1])) fail(`${rel(file)} references runbook ${m[1]}, which has no row in the WP15 runbook table`);
  }
}

// ---------------------------------------------------------------- config keys
// Every backticked config key referenced in the plan exists in the catalog
// (03 section 3). Namespaces come from the catalog itself.
const keyDefs = new Set([...cfg.matchAll(/^\| `([a-z0-9]+\.[A-Za-z0-9.<>*]+)` \|/gm)].map((m) => m[1]));
const namespaces = [...new Set([...keyDefs].map((k) => k.split(".")[0]))];
function patternToRegExp(pat) {
    const parts = pat.split("*");
    const esc = parts.map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/<[^>]+>/g, "[A-Za-z0-9]+")).join("[A-Za-z0-9.]+");
    return new RegExp(`^${esc}$`);
}
const keyPatterns = [...keyDefs].map((d) => patternToRegExp(d)).filter(Boolean);
function keyDefined(k) {
    if (keyDefs.has(k)) return true;
    if (k.includes("*")) {
        const re = patternToRegExp(k);
        return [...keyDefs].some((d) => re.test(d));
    }
    return keyPatterns.some((re) => re.test(k));
}
const KEY_REF = new RegExp("`((?:" + namespaces.join("|") + ")\\.[A-Za-z0-9.<>*]+)`", "g");
for (const file of allDocs) {
    const text = read(file);
    for (const m of text.matchAll(KEY_REF)) {
        if (!keyDefined(m[1])) fail(`${rel(file)} references config key \`${m[1]}\`, which is not in the 03 catalog`);
    }
}

// ---------------------------------------------------------------- report
const summary = `${tasks.size} tasks, ${findings.size} findings, ${dsRows.size} decision switches, ${probeDefs.size} probes, ${runbooks.size} runbooks, ${keyDefs.size} config keys`;
if (problems.length) {
  console.error(`check-coverage: ${problems.length} problem(s) (${summary})`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`check-coverage: OK (${summary})`);
