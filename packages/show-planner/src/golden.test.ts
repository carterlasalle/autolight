import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { planShow, PLANNER_VERSION } from "@autolight/show-planner";
import type { TrackModel } from "@autolight/contracts";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "test-fixtures", "analysis");
const goldenPath = join(dir, "planner-golden.json");

// Planner regression (§129): same track + version + style → stable ShowPlan.
// Intentional planner changes update this fixture deliberately.
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
      mkdirSync(dir, { recursive: true });
      writeFileSync(goldenPath, JSON.stringify(plan, null, 2));
      golden = plan;
    }
    expect(plan).toEqual(golden);
  });
});
