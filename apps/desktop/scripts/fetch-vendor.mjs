#!/usr/bin/env node
// Fetch vendored sidecars for packaging (T-OPS-05, OD-09).
// Downloads pinned, SHA-256-verified, LGPL-only sidecars into
// vendor/<platform>/:
//   - uv (Apache-2.0 OR MIT): the resolver binary the app ships.
//   - FFmpeg (OD-08: LGPL static builds only — GPL is denylisted by
//     tools/license-check.mjs): BtbN win64-lgpl / myndr macOS-lgpl.
// CPython is NOT vendored: the app provisions it at first run through the
// vendored `uv python install` (see electron-builder.cjs); model weights are
// never bundled here (OD-09 downloads them in Setup with consent).
// Run: node scripts/fetch-vendor.mjs [--platform mac-arm64|mac-x64|win-x64]
// No argument fetches the host platform only; CI's package matrix passes the
// platform explicitly (mac-arm64 on macos-latest, win-x64 on windows-latest).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const desktop = join(root, "apps", "desktop");

const vendorDir = join(desktop, "vendor");

// Repo-local scratch for archives + extraction (gitignored with vendor/ and
// excluded from packaging); re-runs reuse verified archives.
const workDir = join(vendorDir, ".work");

// Python version the analysis project requires (analysis/pyproject.toml);
// provisioned on the target machine at first run, never downloaded here.
const PYTHON = "3.12.7";

const UV_VERSION = "0.9.4";

// Pinned sidecar sources. Every URL is immutable (versioned/dated release)
// and every archive is SHA-256 verified before use. Never move a pin to a
// "latest" URL — bump the pin and its digest instead.
const SIDECARS = {
  "mac-arm64": {
    uv: {
      url: `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-aarch64-apple-darwin.tar.gz`,
      sha256: "52793821b13ac7e424f76c47f544b103a9bdd10546f165b327eba225d0ba4993",
      bin: "uv",
      license: "Apache-2.0 OR MIT",
    },
    ffmpeg: {
      url: "https://github.com/myndrai/myndr-ffmpeg-lgpl/releases/download/n7.1.1-4/ffmpeg-7.1.1-macos-arm64.zip",
      sha256: "31a56b291f0a91dc43d0d79d2a3d326b4c3bc1915a424b361ca6af6b791cc5fc",
      bin: "ffmpeg",
      license: "LGPL-2.1-or-later (myndr-ffmpeg-lgpl n7.1.1-4 static macOS arm64 build)",
    },
  },
  "mac-x64": {
    uv: {
      url: `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-x86_64-apple-darwin.tar.gz`,
      sha256: "b6a9682124666840031bde1f7a9ab6ca7389d918b4ee5f3d7e318ad574bb5936",
      bin: "uv",
      license: "Apache-2.0 OR MIT",
    },
    // No pinned LGPL macOS x64 FFmpeg source exists: GPL builds are
    // denylisted and OD-08 requires LGPL. Fail loudly instead of shipping a
    // GPL or missing binary; pick a pinned LGPL source before packaging
    // mac-x64.
    ffmpeg: null,
  },
  "win-x64": {
    uv: {
      url: `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-x86_64-pc-windows-msvc.zip`,
      sha256: "6529c0039c89754d5e2d19a8869694b2f6c7c5a27e89bfe44037fef8077dcc30",
      bin: "uv.exe",
      license: "Apache-2.0 OR MIT",
    },
    ffmpeg: {
      url: "https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-10-12-13-12/ffmpeg-N-127388-g615b07170e-win64-lgpl.zip",
      sha256: "1ef240c07e11f2a5f286a02b7267c21f5a2443cb918344729c0385507491c936",
      bin: "ffmpeg.exe",
      license: "LGPL-2.1-or-later (BtbN FFmpeg-Builds autobuild-2026-10-12-13-12 static win64-lgpl build)",
    },
  },
};

const PLATFORMS = Object.keys(SIDECARS);

function hostPlatform() {
  if (process.platform === "darwin") return process.arch === "arm64" ? "mac-arm64" : "mac-x64";

  if (process.platform === "win32" && process.arch === "x64") return "win-x64";

  return null;
}

const arg = process.argv.find((a) => a.startsWith("--platform="));

const only = arg ? arg.slice("--platform=".length) : hostPlatform();

if (only === null) {
  console.error(`fetch-vendor: unsupported host ${process.platform}/${process.arch}; pass --platform=${PLATFORMS.join("|")}`);

  process.exit(1);
}

if (!PLATFORMS.includes(only)) {
  console.error(`unknown platform ${only}; want ${PLATFORMS.join("|")}`);

  process.exit(1);
}

async function download(url, destPath) {
  const res = await fetch(url, { redirect: "follow" });

  if (!res.ok || res.body === null) throw new Error(`download failed (${res.status}) for ${url}`);

  const chunks = [];

  for await (const chunk of res.body) chunks.push(chunk);

  writeFileSync(destPath, Buffer.concat(chunks));
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

// bsdtar ships on macOS and Windows runners and reads both tar.gz and zip.
function extractArchive(archivePath, destDir) {
  execFileSync("tar", ["-xf", archivePath, "-C", destDir]);
}

function findBinary(dir, name) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);

    if (entry.isFile() && entry.name === name) return path;

    if (entry.isDirectory()) {
      const found = findBinary(path, name);

      if (found !== null) return found;
    }
  }

  return null;
}

async function placeSidecar(platform, name, pin, destDir) {
  const scratch = join(workDir, platform);
  mkdirSync(scratch, { recursive: true });
  const archivePath = join(scratch, basename(new URL(pin.url).pathname));
  const cached = existsSync(archivePath) && sha256File(archivePath) === pin.sha256;

  if (!cached) {
    console.log(`${platform}: downloading ${name} ${pin.url}`);
    await download(pin.url, archivePath);
  }

  const digest = sha256File(archivePath);

  if (digest !== pin.sha256) {
    throw new Error(`${platform}: ${name} sha256 mismatch\n  got  ${digest}\n  want ${pin.sha256}\n  url  ${pin.url}`);
  }

  const extractDir = join(scratch, `${name}-extract`);
  rmSync(extractDir, { recursive: true, force: true });
  mkdirSync(extractDir, { recursive: true });
  extractArchive(archivePath, extractDir);
  const source = findBinary(extractDir, pin.bin);

  if (source === null) {
    throw new Error(`${platform}: ${name} binary ${pin.bin} not found inside ${basename(archivePath)}`);
  }

  const dest = join(destDir, pin.bin);
  copyFileSync(source, dest);

  if (process.platform !== "win32") chmodSync(dest, 0o755);

  return { name: pin.bin, sha256: pin.sha256, source: pin.url, license: pin.license };
}

let failures = 0;

for (const platform of [only]) {
  const dir = join(vendorDir, platform);
  mkdirSync(dir, { recursive: true });
  const pins = SIDECARS[platform];

  const missingSelection = Object.entries(pins)
    .filter(([, pin]) => pin === null)
    .map(([name]) => name);

  for (const name of missingSelection) {
    console.error(`fetch-vendor: ${platform}: no pinned LGPL source for ${name}; add one before packaging ${platform}`);
  }

  if (missingSelection.length > 0) {
    failures += missingSelection.length;

    continue;
  }

  const files = [];

  for (const [name, pin] of Object.entries(pins)) {
    files.push(await placeSidecar(platform, name, pin, dir));
  }

  // Post-fetch existence assertion (T-OPS-05): never write a manifest that
  // advertises artifacts the bundle does not contain.
  const absent = files.filter((file) => !existsSync(join(dir, file.name)));

  if (absent.length > 0) {
    for (const file of absent) console.error(`fetch-vendor: ${platform}: ${file.name} missing after fetch`);

    failures += absent.length;

    continue;
  }

  const manifest = {
    platform,
    cpython: `${PYTHON} provisioned at first run via \`uv python install\` (never bundled)`,
    files,
  };

  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`vendor manifest: ${join("vendor", platform, "manifest.json")} (${files.map((f) => f.name).join(", ")})`);
}

if (failures > 0) {
  console.error(`fetch-vendor: ${failures} missing artifact(s); refusing to continue`);

  process.exit(1);
}

console.log(`fetch-vendor done (${only}); weights intentionally excluded per OD-09`);
