#!/usr/bin/env node
// yarn golden:update --reason "<why the plan changed>"
// The ONLY writer of golden files (T-TRU-15, T-QA-10). Records the reason in
// test-fixtures/goldens/CHANGELOG.md so updates are deliberate, never silent.
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const reasonIdx = process.argv.indexOf("--reason");
const reason = reasonIdx >= 0 ? process.argv[reasonIdx + 1] : "";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { planShow, PLANNER_VERSION } = await import(join(root, "packages/show-planner/dist/index.js"));

const dir = join(root, "test-fixtures", "analysis");
const track = JSON.parse(readFileSync(join(dir, "reference-track.json"), "utf8"));
const style = JSON.parse(readFileSync(join(dir, "reference-style.json"), "utf8"));
const plan = planShow(track, style);
if (plan.plannerVersion !== PLANNER_VERSION) {
  console.error(`planner version drift: plan says ${plan.plannerVersion}, code says ${PLANNER_VERSION}`);
  process.exit(1);
}
writeFileSync(join(dir, "planner-golden.json"), JSON.stringify(plan, null, 2) + "\n");

const logDir = join(root, "test-fixtures", "goldens");
mkdirSync(logDir, { recursive: true });
const stamp = new Date().toISOString();
appendFileSync(join(logDir, "CHANGELOG.md"), `\n## ${stamp}\n\n- planner-golden.json regenerated (planner ${PLANNER_VERSION}): ${reason}\n`);
console.log(`golden updated (planner ${PLANNER_VERSION}): ${reason}`);
