import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";

const [, , ...args] = process.argv;
const dirs = ["apps/desktop", ...readdirSync("packages").map((p) => `packages/${p}`)];
for (const d of dirs) {
  console.log(`== ${d}`);
  execFileSync("yarn", args, { cwd: d, stdio: "inherit" });
}
