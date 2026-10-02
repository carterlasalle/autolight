#!/usr/bin/env node
// TrackModel contract drift check (T-ANA-12 follow-up, interim until the
// JSON-Schema export plus datamodel-code-generator pipeline lands).
// The parity fixture plus the two mirror tests are the drift check today:
// this script asserts the three sources of truth agree on the vocabulary
// both languages validate (19 event types, 13 section kinds, 19 input
// keys) and that both validators accept the same fixture bytes.
// Run: node tools/trackmodel-drift.mjs (also via `yarn truth`).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;
const fail = (m) => { console.error(`trackmodel-drift FAIL: ${m}`); failures++; };

const ts = readFileSync(join(root, "packages/contracts/src/index.ts"), "utf8");
const pyEvents = readFileSync(join(root, "analysis/src/autolight_analysis/events.py"), "utf8");
const pyReadiness = readFileSync(join(root, "analysis/src/autolight_analysis/readiness.py"), "utf8");
const pySchema = readFileSync(join(root, "analysis/src/autolight_analysis/schema.py"), "utf8");

const quoted = (text) => [...text.matchAll(/"([a-z0-9][a-z0-9.\-]*[a-z0-9])"/gi)].map((m) => m[1]);
// TS event enum: the z.enum block following musicalEventTypeSchema.
const tsEnumBlock = ts.split("musicalEventTypeSchema = z.enum([")[1]?.split("])")[0] ?? "";
const tsEvents = quoted(tsEnumBlock);
const pyEventsBlock = pyEvents.split("EVENT_TYPES_19 = (")[1]?.split(")")[0] ?? "";
const pyEventsList = quoted(pyEventsBlock);
if (JSON.stringify(tsEvents) !== JSON.stringify(pyEventsList)) {
  fail(`event enum drift: TS(${tsEvents.length}) [${tsEvents.slice(0, 3)}...] vs Python(${pyEventsList.length}) [${pyEventsList.slice(0, 3)}...]`);
}
if (tsEvents.length !== 19) fail(`TS event enum has ${tsEvents.length} entries, expected 19`);
if (pyEventsList.length !== 19) fail(`Python event enum has ${pyEventsList.length} entries, expected 19`);

const pySchemaBlock = pySchema.split("EVENT_TYPES = (")[1]?.split(")")[0] ?? "";
const pySchemaList = quoted(pySchemaBlock);
if (JSON.stringify(pySchemaList) !== JSON.stringify(pyEventsList)) {
  fail("schema.py EVENT_TYPES drifted from events.py EVENT_TYPES_19");
}

// Input keys: TS readiness mirror vs Python readiness INPUT_KEYS.
const tsReadiness = readFileSync(join(root, "packages/analysis-client/src/readiness.ts"), "utf8");
const tsKeysBlock = tsReadiness.split("INPUT_KEYS = [")[1]?.split("]")[0] ?? "";
const tsKeys = quoted(tsKeysBlock);
// NOTE: "INPUT_KEYS" first appears in the docstring; the tuple assignment
// (INPUT_KEYS: tuple[...] = (...)) is the block we want.
const pyKeysAssign = pyReadiness.split("INPUT_KEYS: tuple")[1] ?? pyReadiness.split("INPUT_KEYS")[1] ?? "";
const pyKeysBlock = pyKeysAssign.split("\n)")[0] ?? "";
const pyKeys = quoted(pyKeysBlock).filter((k) => k.includes("."));
if (JSON.stringify(tsKeys) !== JSON.stringify(pyKeys)) {
  fail(`input-keys drift: TS(${tsKeys.length}) vs Python(${pyKeys.length})`);
}
if (tsKeys.length !== 19) fail(`TS input keys: ${tsKeys.length}, expected 19`);

// Both validators accept the parity fixture bytes.
const fixture = join(root, "test-fixtures/analysis/trackmodel-v2.fixture.json");
const raw = readFileSync(fixture, "utf8");
let model;
try {
  model = JSON.parse(raw);
} catch (e) {
  fail(`parity fixture is not JSON: ${String(e).split("\n")[0]}`);
}
if (model) {
  if (model.schemaVersion !== 2) fail(`parity fixture schemaVersion=${model.schemaVersion}, expected 2`);
  try {
    const out = execFileSync("uv", ["run", "--project", "analysis", "python", "-c",
      "import json,sys; sys.path.insert(0,'analysis/src'); from autolight_analysis.schema import validate_track_model; print(validate_track_model(json.load(open('test-fixtures/analysis/trackmodel-v2.fixture.json'))))"],
      { cwd: root, encoding: "utf8" });
    if (out.trim() !== "[]") fail(`Python validate_track_model returned ${out.trim().slice(0, 120)}`);
  } catch (e) {
    fail(`Python validator failed: ${String(e).split("\n")[0]}`);
  }
}

if (failures > 0) { console.error(`trackmodel-drift: ${failures} failure(s)`); process.exit(1); }
console.error(`trackmodel-drift: OK (19 events, 19 input keys, parity fixture valid both sides)`);
