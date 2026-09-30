import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { planShow, PLANNER_VERSION } from "./index.js";
import type { TrackModel } from "@autolight/contracts";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "test-fixtures", "analysis");
const goldenPath = join(dir, "planner-golden.json");

// Planner regression: same track + version + style gives stable ShowPlan.
// Missing golden FAILS (T-TRU-15). Intentional planner changes update the
// golden deliberately via `yarn golden:update --reason "<text>"`, which
// appends the reason to test-fixtures/goldens/CHANGELOG.md.
describe("planner golden", () => {
  it("matches committed golden output", () => {
    const track = JSON.parse(readFileSync(join(dir, "reference-track.json"), "utf8")) as TrackModel;
    const style = JSON.parse(readFileSync(join(dir, "reference-style.json"), "utf8"));
    const plan = planShow(track, style);
    expect(plan.plannerVersion).toBe(PLANNER_VERSION);
    let golden: unknown;
    try {
      golden = JSON.parse(readFileSync(goldenPath, "utf8"));
    } catch {
      throw new Error(
        `missing golden ${goldenPath}: run \`yarn golden:update --reason "<why the plan changed>"\` to record it deliberately`,
      );
    }
    expect(plan).toEqual(golden);
  });
});
