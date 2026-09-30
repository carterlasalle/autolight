// Dev + packaging bundle for Electron main + preload only (esbuild).
// Renderer moved to Vite (vite.config.ts): `vite` for dev, `vite build` for prod.
//   node scripts/build-main.mjs            → dist/electron/main.cjs
//   node scripts/build-main.mjs --watch    → rebuild on change
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

const job = {
  bundle: true,
  platform: "node",
  format: "cjs",
  alias,
  logLevel: "warning",
  external: ["electron"],
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
  console.log("bundled", outElectron);
}
