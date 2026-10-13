// Dev + packaging bundle for Electron main + preload only (esbuild).
// Renderer moved to Vite (vite.config.ts): `vite` for dev, `vite build` for prod.
//   node scripts/build-main.mjs            → dist/electron/main.cjs (release)
//   node scripts/build-main.mjs --watch    → rebuild on change
//   node scripts/build-main.mjs --test     → test-build (journeys; test API on)
import { context, build } from "esbuild";
import { mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const outElectron = join(root, "dist", "electron");

const workspaceSrc = join(root, "..", "..", "packages");

const alias = Object.fromEntries(
  readdirSync(workspaceSrc).map((p) => [`@autolight/${p}`, join(workspaceSrc, p, "src", "index.ts")]),
);

// TEST-BUILD ONLY surface (T-QA-02): the define below lets esbuild
// dead-code-eliminate the whole test API from release bundles. Only
// `--test` (or AUTOLIGHT_TEST_BUILD=1) builds include it; tools/bundle-scan.mjs
// enforces the absence in `yarn truth`.
const testBuild = process.argv.includes("--test") || process.env.AUTOLIGHT_TEST_BUILD === "1";

const job = {
  bundle: true,
  platform: "node",
  format: "cjs",
  alias,
  logLevel: "warning",
  external: ["electron"],
  // Syntax-only minification: constant-folds the test-build define and
  // removes the resulting dead branches (no identifier renaming, no
  // whitespace stripping — stack traces stay readable).
  minifySyntax: true,
  define: { __AUTOLIGHT_TEST_BUILD__: JSON.stringify(testBuild) },
  entryPoints: [join(root, "electron", "main.ts")],
  outfile: join(outElectron, "main.cjs"),
};

mkdirSync(outElectron, { recursive: true });

if (process.argv.includes("--watch")) {
  const ctx = await context(job);
  await ctx.watch();
  console.log("watching", outElectron);
} else {
  await build(job);
  console.log("bundled", outElectron, testBuild ? "(test)" : "(release)");
}
