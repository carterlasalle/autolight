// Preload bundle (esbuild, CJS). See build-main.mjs for the split rationale.
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
  entryPoints: [join(root, "electron", "preload.ts")],
  outfile: join(outElectron, "preload.cjs"),
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
