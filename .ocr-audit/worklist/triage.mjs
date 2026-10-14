// OCR audit triage: for every batch comment, decide whether it is resolved
// against CURRENT file contents.
//  - resolution sidecar entry for (batch, path, line) -> applied (verified by a
//    human/agent against the live code; see resolutions.json evidence)
//  - suggestion_code found in the file          -> applied
//  - existing_code still present                -> open
//  - existing_code gone and no suggestion       -> applied (context was removed)
//  - neither snippet found / no snippets        -> unknown (manual review)
import { readFileSync, readdirSync } from "node:fs";

const DIR = ".ocr-audit/worklist/batches";
const norm = (s) => String(s).replace(/\s+/g, " ").trim();
const cache = new Map();

let resolutions = {};

try {
  resolutions = JSON.parse(readFileSync(".ocr-audit/worklist/resolutions.json", "utf8"));
} catch {
  resolutions = {};
}

function contentOf(path) {
  if (cache.has(path)) return cache.get(path);
  let content = null;

  try { content = readFileSync(path, "utf8"); } catch { content = null; }
  cache.set(path, content);

  return content;
}

const results = [];

for (const f of readdirSync(DIR).sort()) {
  if (!f.endsWith(".json")) continue;
  const batch = JSON.parse(readFileSync(`${DIR}/${f}`, "utf8"));
  const batchNo = f.replace("batch-", "").replace(".json", "");
  const verified = resolutions[batchNo] ?? resolutions[`batch-${batchNo}`] ?? [];
  const open = [];
  const unknown = [];
  let applied = 0;
  let total = 0;

  for (const [path, comments] of Object.entries(batch)) {
    const content = contentOf(path);

    for (const c of comments) {
      total += 1;
      const startLine = c.start_line ?? c.startLine ?? "?";
      const suggestion = c.suggestion_code ?? c.suggestionCode ?? null;
      const existing = c.existing_code ?? c.existingCode ?? null;
      const has = (s) => s !== null && content !== null && norm(content).includes(norm(s));

      if (verified.some((r) => r.path === path && r.line === startLine)) {
        applied += 1;
        continue;
      }

      if (suggestion !== null && has(suggestion)) {
        applied += 1;
        continue;
      }

      if (existing !== null && has(existing)) {
        open.push({ path, line: startLine });
        continue;
      }

      if (existing !== null && !has(existing)) {
        applied += 1;
        continue;
      }

      unknown.push({ path, line: startLine });
    }
  }

  results.push({ batch: batchNo, total, applied, open: open.length, unknown: unknown.length, openItems: open, unknownItems: unknown });
}

console.log(JSON.stringify(results, null, 1));
