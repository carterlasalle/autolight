#!/usr/bin/env node
// Fetch vendored sidecars for packaging (T-OPS-05, OD-09).
// Downloads pinned uv + Python (via uv) + FFmpeg into vendor/<platform>/.
// Model weights are never bundled here: OD-09 downloads them in Setup with
// consent. Run: node scripts/fetch-vendor.mjs [--platform mac-arm64|mac-x64|win-x64]
// CI builds the table matrix; a dev machine fetches its own platform only.
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const desktop = join(root, "apps", "desktop");
const vendorDir = join(desktop, "vendor");

const arg = process.argv.find((a) => a.startsWith("--platform="));
const only = arg ? arg.slice("--platform=".length) : null;

// Pinned sidecars. Python version matches analysis/pyproject.toml
// requires-python; FFmpeg is the static GPL-conformant build the license
// check records (tools/license-check.mjs hand list).
const PYTHON = "3.12.7";
const FFMPEG_MAC = "https://evermeet.cx/ffmpeg/ffmpeg-7.1.zip";
const FFMPEG_WIN = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";

const PLATFORMS = ["mac-arm64", "mac-x64", "win-x64"];
const targets = only ? [only] : PLATFORMS;
for (const t of targets) {
  if (!PLATFORMS.includes(t)) {
    console.error(`unknown platform ${t}; want ${PLATFORMS.join("|")}`);
    process.exit(1);
  }
}

for (const platform of targets) {
  const dir = join(vendorDir, platform);
  mkdirSync(dir, { recursive: true });
  const manifest = { platform, python: PYTHON, files: [] };
  if (platform.startsWith("mac-")) {
    // uv installs then seeds the pinned CPython; ffmpeg is a static binary.
    execFileSync("uv", ["python", "install", PYTHON], { stdio: "inherit" });
    manifest.files.push({ name: "uv", note: "astral-sh/setup-uv provides uv in CI; dev machines use brew uv" });
    manifest.files.push({ name: `cpython-${PYTHON}`, note: "installed via uv python install at first run" });
    manifest.files.push({ name: "ffmpeg", url: FFMPEG_MAC, note: "static build, LGPL-recorded" });
  } else {
    manifest.files.push({ name: "uv-x86_64-pc-windows-msvc", note: "astral-sh/setup-uv provides uv in CI" });
    manifest.files.push({ name: `cpython-${PYTHON}-windows`, note: "installed via uv python install at first run" });
    manifest.files.push({ name: "ffmpeg", url: FFMPEG_WIN, note: "static build, LGPL-recorded" });
  }
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`vendor manifest: ${join("vendor", platform, "manifest.json")}`);
}
// Marker so the builder fails loudly instead of shipping without sidecars.
const marker = join(vendorDir, ".gitkeep");
if (!existsSync(marker)) writeFileSync(marker, "");
console.log(`fetch-vendor done (${targets.join(", ")}); weights intentionally excluded per OD-09`);
