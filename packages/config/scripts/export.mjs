#!/usr/bin/env node
// yarn workspace @autolight/config run export
// Regenerates docs/config-reference.md and
// analysis/src/autolight_analysis/config_schema.json from the catalog in
// docs/finish/03-config-and-decisions.md section 3. CI fails if stale.
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
function parseCatalog() {
  const text = readFileSync(join(root, "docs/finish/03-config-and-decisions.md"), "utf8");
  const rows = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith("| \`")) continue;
    const cells = line.slice(1, -1).split("|").map((c) => c.trim());
    if (cells.length === 6) {
      const [key, def, unit, range, receipt, ls] = cells;
      rows.push({ key: key.replace(/`/g, ""), def: def.replace(/`/g, ""), unit, range, receipt, liveSafe: ls.startsWith("Y") });
    } else if (cells.length === 5) {
      const [key, def, unit, receipt, ls] = cells;
      rows.push({ key: key.replace(/`/g, ""), def: def.replace(/`/g, ""), unit, range: "", receipt, liveSafe: ls.startsWith("Y") });
    }
  }
  return rows;
}

const rows = parseCatalog();

function tsType(def) {
  if (def === "true" || def === "false") return "boolean";
  if (/^-?[\d.]+$/.test(def)) return "number";
  if (def.startsWith("[") || def.startsWith("{")) return "json";
  return "string";
}

// 1. registry.ts
let reg = `import { z } from "zod";\n\n// @autolight/config registry (T-CFG-01). Generated from\n// docs/finish/03-config-and-decisions.md section 3 by\n// \`yarn workspace @autolight/config run export\`. Do not hand-edit: edit the\n// catalog, rerun export, commit both. ${rows.length} keys.\n\nexport interface KeyDef {\n  key: string;\n  type: "string" | "number" | "boolean" | "json";\n  defaultRaw: string;\n  unit: string;\n  range: string;\n  receipt: string;\n  liveSafe: boolean;\n  scope: "app" | "venue" | "device" | "style" | "session";\n}\n\nexport const KEYS: readonly KeyDef[] = [\n`;
for (const r of rows) {
  let scope = "app";
  if (r.key.includes("<fixtureId>") || r.key.startsWith("govee.device.")) scope = "device";
  else if (r.key.startsWith("planner.") || r.key.startsWith("mixer.") || r.key.startsWith("render.")) scope = "style";
  reg += `  { key: ${JSON.stringify(r.key)}, type: ${JSON.stringify(tsType(r.def))}, defaultRaw: ${JSON.stringify(r.def)}, unit: ${JSON.stringify(r.unit)}, range: ${JSON.stringify(r.range)}, receipt: ${JSON.stringify(r.receipt)}, liveSafe: ${r.liveSafe}, scope: ${JSON.stringify(scope)} },\n`;
}
reg += `] as const;\n\nexport type ConfigKey = (typeof KEYS)[number]["key"];\n\nconst byKey = new Map(KEYS.map((k) => [k.key, k]));\n\nexport function defineKey(key: string): KeyDef {\n  const def = byKey.get(key);\n  if (!def) throw new Error(\`unknown-config-key: \${key}\`);\n  return def;\n}\n\nexport function defaultFor(key: string): unknown {\n  const def = defineKey(key);\n  if (def.type === "boolean") return def.defaultRaw === "true";\n  if (def.type === "number") return Number(def.defaultRaw);\n  if (def.type === "json") { try { return JSON.parse(def.defaultRaw); } catch { return def.defaultRaw; } }\n  return def.defaultRaw;\n}\n\nexport function defaultsObject(): Record<string, unknown> {\n  const out: Record<string, unknown> = {};\n  for (const k of KEYS) out[k.key] = defaultFor(k.key);\n  return out;\n}\n\nexport const defaultsSchema = z.record(z.string(), z.unknown());\n`;
writeFileSync(join(root, "packages/config/src/registry.ts"), reg);

// 2. docs/config-reference.md
let md = `# Config reference\n\nGenerated from \`docs/finish/03-config-and-decisions.md\` section 3 by \`yarn workspace @autolight/config run export\`. Do not hand-edit.\n\n${rows.length} keys. Receipt kinds: spec (SPEC mandates), upstream (measured upstream), measured (measured by us), unmeasured (starting guess with owning task).\n\n| Key | Default | Unit | Range | Receipt | Live-safe |\n| --- | --- | --- | --- | --- | --- |\n`;
for (const r of rows) md += `| \`${r.key}\` | \`${r.def}\` | ${r.unit} | ${r.range} | ${r.receipt} | ${r.liveSafe ? "Y" : "N"} |\n`;
writeFileSync(join(root, "docs/config-reference.md"), md);

// 3. analysis JSON schema + defaults for Python (T-CFG-03)
const schema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "autolight-config",
  type: "object",
  properties: Object.fromEntries(rows.map((r) => [r.key, {
    type: tsType(r.def) === "json" ? ["array", "object", "string", "number", "boolean"] : tsType(r.def),
    default: (() => { try { return JSON.parse(r.def); } catch { return r.def; } })(),
    description: `${r.unit} ${r.range} [${r.receipt}]`,
  }])),
};
writeFileSync(join(root, "analysis/src/autolight_analysis/config_schema.json"), JSON.stringify(schema, null, 2) + "\n");
const defaults = Object.fromEntries(rows.map((r) => [r.key, (() => { try { return JSON.parse(r.def); } catch { return r.def; } })()]));
writeFileSync(join(root, "analysis/src/autolight_analysis/config_defaults.json"), JSON.stringify(defaults, null, 2) + "\n");

console.log(`export: ${rows.length} keys -> packages/config/src/registry.ts, docs/config-reference.md, analysis config_schema.json + config_defaults.json`);
