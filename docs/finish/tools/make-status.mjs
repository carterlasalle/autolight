#!/usr/bin/env node
// docs/finish/tools/make-status.mjs
//
// Builds or refreshes docs/finish/STATUS.md from the task headings in the
// plan and the findings register. Existing status, evidence and note cells
// are preserved, so rerun it after adding a task:
//   node docs/finish/tools/make-status.mjs
// No dependencies. The coverage checker (check-coverage.mjs) validates the
// result.

import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const planDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const statusPath = join(planDir, "STATUS.md");
const read = (n) => readFileSync(join(planDir, n), "utf8");

const files = readdirSync(planDir)
  .filter((n) => n.endsWith(".md") && (n.startsWith("wp") || n.startsWith("03-") || n.startsWith("04-")))
  .sort();

const tasks = [];
for (const file of files) {
  const text = read(file);
  const heads = [...text.matchAll(/^### (T-[A-Z]+-\d{2})\b(.*)$/gm)];
  heads.forEach((m, i) => {
    const start = m.index;
    const end = i + 1 < heads.length ? heads[i + 1].index : text.length;
    const body = text.slice(start, end);
    const closes = [...body.matchAll(/\bF-[A-Z]+-\d{2}\b/g)].map((x) => x[0]);
    const uniq = [...new Set(closes)].join(", ");
    tasks.push({ id: m[1], title: m[2].trim(), file, closes: uniq });
  });
}

// Milestone of each task: the milestone in which its whole definition of done
// can be met (README "Milestones"). Explicit IDs first, then prefix defaults.
const MILESTONE_BY_ID = {
  M0: ["T-CFG-01", "T-CFG-02", "T-CFG-03", "T-CFG-04", "T-CFG-05", "T-ARC-01", "T-ARC-02", "T-ARC-03",
    "T-TRU-01", "T-TRU-02", "T-TRU-04", "T-TRU-05", "T-TRU-06", "T-TRU-07", "T-TRU-08", "T-TRU-10",
    "T-TRU-11", "T-TRU-13", "T-TRU-15", "T-TRU-16", "T-TRU-17", "T-DOC-03", "T-GOV-14", "T-UI-01",
    "T-SEC-03", "T-OPS-01", "T-QA-02"],
  M1: ["T-CFG-06", "T-ARC-04", "T-ARC-05", "T-ARC-06", "T-TRU-03", "T-TRU-12", "T-TRU-14",
    "T-GOV-01", "T-GOV-02", "T-GOV-03", "T-GOV-04", "T-GOV-05", "T-GOV-06", "T-GOV-07", "T-GOV-08",
    "T-GOV-09", "T-GOV-10", "T-GOV-11", "T-GOV-12", "T-RBL-01", "T-RBL-02", "T-RBL-03", "T-RBL-05",
    "T-RBL-06", "T-LIVE-01", "T-LIVE-02", "T-LIVE-03", "T-LIVE-04", "T-LIVE-05", "T-LIVE-06", "T-LIVE-08",
    "T-RUN-01", "T-RUN-02", "T-RUN-03", "T-RUN-04", "T-RUN-05", "T-RUN-07", "T-REND-01", "T-UI-03",
    "T-DATA-01", "T-DATA-02", "T-DATA-03", "T-DATA-04", "T-SEC-04", "T-QA-03", "T-QA-05"],
  M2: ["T-DOC-02", "T-GOV-13", "T-GOV-15", "T-GOV-17", "T-GOV-18", "T-GOV-19",
    "T-BLE-01", "T-BLE-02", "T-BLE-03", "T-BLE-04", "T-BLE-05", "T-BLE-06", "T-BLE-07", "T-BLE-09", "T-BLE-10",
    "T-MAT-01", "T-MAT-02", "T-MAT-03", "T-MAT-04", "T-CLD-01", "T-CLD-02", "T-FOV-01", "T-FOV-02",
    "T-LIVE-09", "T-LIVE-10", "T-LIVE-11", "T-LIVE-12", "T-LIVE-13", "T-LIVE-14", "T-LIVE-15",
    "T-FLX-01", "T-FLX-02", "T-FLX-03", "T-FLX-04", "T-FLX-07",
    "T-SER-01", "T-SER-04", "T-SER-05",
    "T-RUN-06", "T-AUD-01", "T-AUD-02", "T-AUD-04", "T-SEC-01", "T-QA-04"],
  M3: ["T-TRU-09", "T-RBL-04", "T-RBL-07", "T-ID-01", "T-ID-02", "T-LIVE-07", "T-FLX-06",
    "T-SER-02", "T-SER-03",
    "T-ANA-01", "T-ANA-02", "T-ANA-03", "T-ANA-04", "T-ANA-05", "T-ANA-06", "T-ANA-07", "T-ANA-08",
    "T-ANA-09", "T-ANA-10", "T-ANA-11", "T-ANA-12", "T-ANA-13", "T-ANA-14", "T-ANA-15", "T-ANA-16",
    "T-ANA-18",
    "T-PLAN-01", "T-PLAN-02", "T-PLAN-03", "T-PLAN-05", "T-PLAN-06", "T-PLAN-07", "T-PLAN-08",
    "T-PLAN-09", "T-PLAN-10", "T-PLAN-11", "T-PLAN-12", "T-PLAN-13", "T-PLAN-14", "T-PLAN-15",
    "T-RUN-08", "T-REND-03", "T-OPS-02", "T-QA-09"],
  M4: ["T-FOV-03",
    "T-ROOM-01", "T-ROOM-02", "T-ROOM-03", "T-ROOM-04", "T-ROOM-05", "T-ROOM-06", "T-ROOM-07",
    "T-ROOM-08", "T-ROOM-09", "T-ROOM-10", "T-ROOM-11", "T-ROOM-12",
    "T-PLAN-04", "T-REND-02", "T-REND-04", "T-REND-05", "T-REND-06"],
  M5: ["T-CFG-07", "T-DOC-04", "T-GOV-16", "T-BLE-08", "T-ID-03", "T-FLX-05",
    "T-RUN-09", "T-MIX-01", "T-MIX-02", "T-MIX-03", "T-MIX-04", "T-MIX-05", "T-MIX-06", "T-REND-07",
    "T-AUD-03",
    "T-UI-02", "T-UI-04", "T-UI-05", "T-UI-06", "T-UI-07", "T-UI-08", "T-UI-09", "T-UI-10",
    "T-UI-11", "T-UI-12", "T-UI-13", "T-UI-14", "T-UI-15",
    "T-DATA-05", "T-DATA-06", "T-SEC-02", "T-SEC-05", "T-OPS-03", "T-OPS-04", "T-OPS-05", "T-OPS-07"],
  M6: ["T-DOC-01", "T-SER-06", "T-ANA-17", "T-OPS-06",
    "T-QA-01", "T-QA-06", "T-QA-07", "T-QA-08", "T-QA-10", "T-QA-11", "T-QA-12", "T-QA-13"],
};
const MILESTONE_BY_PREFIX = {
  "T-CFG": "M0", "T-ARC": "M0", "T-TRU": "M0", "T-DOC": "M0", "T-GOV": "M1",
  "T-UI": "M5", "T-SEC": "M1", "T-OPS": "M5", "T-QA": "M6",
  "T-RBL": "M1", "T-LIVE": "M1", "T-RUN": "M1", "T-REND": "M4", "T-DATA": "M1",
  "T-BLE": "M2", "T-MAT": "M2", "T-CLD": "M2", "T-FOV": "M2", "T-FLX": "M2",
  "T-SER": "M2", "T-AUD": "M2", "T-ID": "M3", "T-ANA": "M3", "T-PLAN": "M3",
  "T-MIX": "M5", "T-ROOM": "M4",
};
const explicit = new Map();
for (const [ms, ids] of Object.entries(MILESTONE_BY_ID)) for (const id of ids) explicit.set(id, ms);
function milestone(id) {
  if (explicit.has(id)) return explicit.get(id);
  const prefix = id.split("-").slice(0, 2).join("-");
  return MILESTONE_BY_PREFIX[prefix] ?? "M0";
}

// Preserve existing cells.
const prev = new Map();
if (existsSync(statusPath)) {
  const old = readFileSync(statusPath, "utf8");
  for (const m of old.matchAll(/^\| (T-[A-Z]+-\d{2}) \|(.*?)\|\s*$/gm)) {
    prev.set(m[1], m[2]);
  }
}

const register = read("01-findings-register.md");
const findings = [...register.matchAll(/^\| (F-[A-Z]+-\d{2}) \|(.*)\|\s*$/gm)].map((m) => ({ id: m[1], rest: m[2] }));

const wp15 = read("wp15-verification-qualification.md");
const runbooks = [...wp15.matchAll(/^\| `(HW-[A-Z-]+-\d{2})` \| (.*?) \| (.*?) \|\s*$/gm)].map((m) => ({ id: m[1], purpose: m[2], tasks: m[3] }));

const order = ["M0", "M1", "M2", "M3", "M4", "M5", "M6"];
const byMs = new Map(order.map((m) => [m, []]));
for (const t of tasks) byMs.get(milestone(t.id)).push(t);

let out = `# STATUS

The single status board for the finish plan. Update it in the same change
that does the work (\`00-agent-briefing.md\` section 8). Generated skeleton:
\`node docs/finish/tools/make-status.mjs\` (keeps existing cells). Checked by
\`node docs/finish/tools/check-coverage.mjs\`.

Status values: \`TODO\`, \`IN-PROGRESS\`, \`DONE-VERIFIED\` (needs
\`docs/finish/evidence/<TASK-ID>/README.md\`), \`BLOCKED-HARDWARE\` (needs
\`docs/finish/evidence/<TASK-ID>/runbook.md\`), \`BLOCKED-OWNER-DECISION\` (name
the decision below), \`CLOSED-OWNER-DECLINED\` (needs
\`docs/finish/evidence/<TASK-ID>/decision.md\`; terminal, see the briefing).

## Summary

| Milestone | Tasks | TODO | IN-PROGRESS | DONE-VERIFIED | BLOCKED | CLOSED-OWNER-DECLINED |
| --- | --- | --- | --- | --- | --- | --- |
`;
for (const ms of order) {
  const list = byMs.get(ms);
  let todo = 0, prog = 0, done = 0, blocked = 0, declined = 0;
  for (const t of list) {
    const cell = prev.get(t.id) ?? "";
    if (cell.includes("DONE-VERIFIED")) done++;
    else if (cell.includes("IN-PROGRESS")) prog++;
    else if (cell.includes("BLOCKED")) blocked++;
    else if (cell.includes("CLOSED-OWNER-DECLINED")) declined++;
    else todo++;
  }
  out += `| ${ms} | ${list.length} | ${todo} | ${prog} | ${done} | ${blocked} | ${declined} |\n`;
}
out += `\nMilestone contents and exit proofs are in \`README.md\`.\n`;

for (const ms of order) {
  out += `\n## Tasks in ${ms}\n\n| Task | Title | File | Milestone | Status | Evidence | Notes |\n| --- | --- | --- | --- | --- | --- | --- |\n`;
  for (const t of byMs.get(ms)) {
    const old = prev.get(t.id);
    let status = "`TODO`", evidence = "none yet", notes = t.closes ? `Closes ${t.closes}` : "";
    if (old) {
      const cells = old.split("|").map((c) => c.trim());
      if (cells.length >= 5) {
        status = cells[3] || status;
        evidence = cells[4] || evidence;
        notes = cells[5] || notes;
      }
    }
    out += `| ${t.id} | ${t.title} | \`${t.file}\` | ${ms} | ${status} | ${evidence} | ${notes} |\n`;
  }
}

out += `\n## Findings\n\nA finding is closed only when every task in "Closed by" is \`DONE-VERIFIED\`
(or \`BLOCKED-HARDWARE\` for a physical step with the runbook done by the owner).
\`F-X-*\` rows are review claims verified false or unverified; they are listed
so nobody acts on them as stated.\n\n| Finding | Verification | Closed by | State |\n| --- | --- | --- | --- |\n`;
for (const f of findings) {
  const cells = f.rest.split("|").map((c) => c.trim());
  out += `| ${f.id} | ${cells[0] ?? ""} | ${cells[cells.length - 2] ?? ""} | ${cells[cells.length - 1] ?? ""} |\n`;
}

out += `
## Owner decisions

Record the owner's answer, the date and the measurements shown. Tasks waiting
on one of these are \`BLOCKED-OWNER-DECISION\` for that step only; everything
else in the task is built and verified first.

| ID | Decision | Options | Measurements to show | Tasks | Answer |
| --- | --- | --- | --- | --- | --- |
| OD-01 | Rekordbox version path | Stay on 7.2.10; update to 7.2.17 or 7.2.18 (rkbx_link on macOS); update to 7.2.19+ (Lighting integration); use Windows with a paid rkbx_link license, which covers 7.2.10 | Provider matrix from \`T-LIVE-15\` with SIM accuracy per provider | T-LIVE-03, T-LIVE-09, T-LIVE-15 | open |
| OD-02 | SoundSwitch for the one-time Lighting capture | Creative or Professional plan, or trial; or skip Lighting | Capture matrix size and time estimate | T-LIVE-09 | open |
| OD-03 | Install rkbx_link as a sidecar | Yes (re-sign Rekordbox, run with sudo); no | Accuracy and risk summary | T-LIVE-03, T-LIVE-04 | open |
| OD-04 | Clean-room memory reader | Enable with consent; do not build further than the test target | Same as OD-03 plus maintenance cost | T-LIVE-11, T-SEC-05 | open |
| OD-05 | Ship BLE encrypted-link keys | Ship; require the user to supply; disable encrypted link | Which owner units need it | T-BLE-07 | open |
| OD-06 | Signing spend | Apple Developer ID, Windows certificate, or unsigned builds | Install friction with and without | T-OPS-05 | open |
| OD-07 | Ableton Link licensing | Sidecar only; request Ableton's license for the SDK | Link value measured in the composite provider | T-LIVE-12 | open |
| OD-08 | Acoustic fingerprint binary | Bundle LGPL fpcalc; own implementation; pcm-hash only | Re-encode match rate | T-ID-01 | open |
| OD-09 | ML weights distribution | Bundle where licenses allow; download in Setup | Sizes, licenses | T-ANA-05, T-OPS-05 | open |
| OD-10 | Validation set tracks | The owner confirms the candidate list per category | Candidate list with analysis hints | T-QA-09 | open |
| OD-11 | Update mechanism | electron-builder updater; manual downloads | n/a | T-OPS-04 | open |
| OD-12 | Windows reference machine | Which machine runs Windows qualification | n/a | T-QA-05, T-QA-11 | open |
`;

out += `
## Hardware and real-software runbook queue

Run in this order once the code for each is \`DONE-VERIFIED\` on SIM. Results go
in the named task's evidence folder.

| Runbook | Purpose | Tasks | Done |
| --- | --- | --- | --- |
`;
for (const r of runbooks) out += `| ${r.id} | ${r.purpose} | ${r.tasks} | no |\n`;

out += `
## Final gate runs

Paste the exact commands and outputs of the last runs here when you stop
(\`00-agent-briefing.md\` section 9).

| Command | Date | Result | Output file |
| --- | --- | --- | --- |
| \`node docs/finish/tools/check-coverage.mjs\` | | | |
| \`yarn verify:all\` | | | |
| \`yarn gates\` | | | |

## Uncertainties

List anything you are unsure of here, as uncertainty, not as success.
`;

writeFileSync(statusPath, out);
console.log(`STATUS.md written: ${tasks.length} tasks, ${findings.length} findings, ${runbooks.length} runbooks`);
