#!/usr/bin/env node
// yarn golden:update --reason "<why the plan changed>"
// The ONLY writer of golden files (T-TRU-15, T-QA-10). Records the reason in
// test-fixtures/goldens/CHANGELOG.md so updates are deliberate, never silent.
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const reasonIdx = process.argv.indexOf("--reason");

const reason = reasonIdx >= 0 ? (process.argv[reasonIdx + 1] ?? "") : "";

if (!reason.trim()) {
  console.error('missing --reason "<why the plan changed>"; refusing to update goldens silently');
  process.exit(1);
}

// Single-line changelog entry: newlines would forge headings/sections.
const safeReason = reason.replace(/\s+/g, " ").trim();

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

try {
  const { planShow, PLANNER_VERSION } = await import(join(root, "packages/show-planner/dist/index.js"));

  const dir = join(root, "test-fixtures", "analysis");

  const track = JSON.parse(readFileSync(join(dir, "reference-track.json"), "utf8"));

  const style = JSON.parse(readFileSync(join(dir, "reference-style.json"), "utf8"));

  const plan = planShow(track, style);

  if (plan.plannerVersion !== PLANNER_VERSION) {
    console.error(`planner version drift: plan says ${plan.plannerVersion}, code says ${PLANNER_VERSION}`);
    process.exit(1);
  }

  // Validate everything (including the changelog line) before mutating, so a
  // later failure can never leave a silent golden change behind.
  const goldenPath = join(dir, "planner-golden.json");
  const goldenText = JSON.stringify(plan, null, 2) + "\n";
  const logDir = join(root, "test-fixtures", "goldens");
  const stamp = new Date().toISOString();
  const entry = `\n## ${stamp}\n\n- planner-golden.json regenerated (planner ${PLANNER_VERSION}): ${safeReason}\n`;

  mkdirSync(logDir, { recursive: true });

  // Atomic write: temp file + rename, so readers never see a truncated golden.
  const tmp = join(tmpdir(), `planner-golden-${process.pid}.json`);
  writeFileSync(tmp, goldenText);
  JSON.parse(readFileSync(tmp, "utf8"));
  renameSync(tmp, goldenPath);

  appendFileSync(join(logDir, "CHANGELOG.md"), entry);

  console.log(`golden updated (planner ${PLANNER_VERSION}): ${safeReason}`);
} catch (error) {
  console.error(`golden update failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
