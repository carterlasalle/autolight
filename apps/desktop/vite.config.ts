import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const workspaceSrc = join(root, "..", "..", "packages");
const workspaceAlias = Object.fromEntries(
  readdirSync(workspaceSrc).map((p) => [`@autolight/${p}`, join(workspaceSrc, p, "src", "index.ts")]),
);

// Renderer only: main + preload stay on esbuild (scripts/build-main.mjs,
// scripts/build-preload.mjs). Dev: `vite` → http://localhost:5173, Electron
// loads it. Prod: `vite build` → dist/renderer/index.html → loadFile.
export default defineConfig({
  root: join(root, "src", "renderer"),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      ...workspaceAlias,
      "@": join(root, "src", "renderer"),
    },
  },
  base: "./",
  build: {
    outDir: join(root, "dist", "renderer"),
    emptyOutDir: true,
  },
  server: { port: 5173, strictPort: true, fs: { allow: [join(root, "..", "..")] } },
});
