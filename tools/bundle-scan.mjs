#!/usr/bin/env node
// Release bundle scan (T-TRU-02 / T-TRU-04 / T-SEC-01): dist artifacts must
// never contain test-only surfaces — the journey test API, the recording
// channel, fixture names, or a shipped secrets fixture file. Fails closed:
// a missing dist is an error, never a silent skip. Run via `yarn truth`
// after `yarn build`; if it fails right after `test:e2e`, rebuild with
// `yarn workspace @autolight/desktop build` (e2e deliberately builds the
// test-enabled main bundle).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const TARGETS = ["apps/desktop/dist"];

// Content markers: identifiers, channels, and fixture names that only exist
// in test builds.
const CONTENT_MARKERS = [
  "__autolightTestApi",
  "registerTestApi",
  "qa/recording-frames",
  "live-homecoming",
  "live-deck2",
];

// Path markers: file names that must never ship (fixtures, secret stores).
const PATH_MARKERS = ["secrets.enc.json", "test-fixtures"];

const TEXT_EXT = /\.(cjs|mjs|js|html|json|map|css|svg|txt)$/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);

    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }

  return out;
}

let hits = 0;

for (const target of TARGETS) {
  if (!existsSync(target)) {
    console.error(`bundle-scan: ${target} missing; run \`yarn build\` first`);

    process.exit(1);
  }

  for (const file of walk(target)) {
    for (const marker of PATH_MARKERS) {
      if (file.includes(marker)) {
        console.error(`bundle-scan: forbidden path ${file} (${marker})`);
        hits += 1;
      }
    }

    if (!TEXT_EXT.test(file)) continue;

    const text = readFileSync(file, "utf8");

    for (const marker of CONTENT_MARKERS) {
      if (text.includes(marker)) {
        console.error(`bundle-scan: ${file} contains "${marker}"`);
        hits += 1;
      }
    }
  }
}

if (hits > 0) {
  console.error(`bundle-scan: ${hits} forbidden marker(s) in release bundles`);
  process.exit(1);
}

console.log("bundle-scan: dist clean");
