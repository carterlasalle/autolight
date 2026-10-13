import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const root = dirname(fileURLToPath(import.meta.url));

// Build SHA: short HEAD + dirty flag + timestamp, baked at bundle time so the
// UI can prove which commit it runs. Dev and prod both get it (dev re-evaluates
// per Vite restart; prod bakes per build).
function buildInfo(): { sha: string; dirty: boolean; builtAt: string } {
  let sha = "unknown";
  let dirty = false;

  try {
    sha = execSync("git rev-parse --short HEAD", { cwd: root }).toString().trim();
    dirty = execSync("git status --porcelain", { cwd: root }).toString().trim().length > 0;
  } catch { /* not a git checkout: stay unknown */ }

  return { sha, dirty, builtAt: new Date().toISOString() };
}

const info = buildInfo();

const workspaceSrc = join(root, "..", "..", "packages");

const workspaceAlias = Object.fromEntries(
  readdirSync(workspaceSrc).map((p) => [`@autolight/${p}`, join(workspaceSrc, p, "src", "index.ts")]),
);

// Browser-safe subpaths (T-TRU-04 spine fix). Vite matches string aliases
// by prefix, so a barrel like `@autolight/rekordbox-live` swallows any
// `/subpath` when the object form is used. The regex below maps every
// `@autolight/<pkg>/<module>` to its source file and runs FIRST, so
// subpath imports never fall through to a barrel (which may re-export
// node: modules like dgram and blank-screen dev).
const subpathAlias = [
  {
    find: /^@autolight\/([^/]+)\/([^/]+)$/,
    replacement: join(workspaceSrc, "$1", "src", "$2.ts"),
  },
];

// Renderer only: main + preload stay on esbuild (scripts/build-main.mjs,
// scripts/build-preload.mjs). Dev: `vite` → http://localhost:5173, Electron
// loads it. Prod: `vite build` → dist/renderer/index.html → loadFile.
// Root is apps/desktop/src (spec 83 layout: app, routes, components,
// features, styles) with index.html at src/index.html.
export default defineConfig({
  root: join(root, "src"),
  plugins: [react(), tailwindcss()],
  define: {
    __AUTOLIGHT_BUILD__: JSON.stringify(info),
  },
  resolve: {
    alias: [
      ...subpathAlias,
      ...Object.entries(workspaceAlias).map(([find, replacement]) => ({ find, replacement })),
      { find: "@", replacement: join(root, "src") },
    ],
  },
  base: "./",
  build: {
    outDir: join(root, "dist", "renderer"),
    emptyOutDir: true,
  },
  server: { port: 5173, strictPort: true, fs: { allow: [join(root, "..", "..")] } },
});
