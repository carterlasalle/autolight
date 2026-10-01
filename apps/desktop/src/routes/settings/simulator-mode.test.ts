import { describe, expect, it } from "vitest";
import { isModalAllowed } from "../../app/shortcuts.js";
import { isSimulatorScenario, routeDialogDuringLive, SIMULATOR_SCENARIOS, simulatorIntent, withinFrameBudget } from "./simulator-mode.js";

describe("simulator, perf and modal guard (T-UI-12/13/15)", () => {
  it("names the five scenarios and builds the mode intent", () => {
    expect(SIMULATOR_SCENARIOS).toHaveLength(5);
    expect(isSimulatorScenario("device-loss")).toBe(true);
    expect(isSimulatorScenario("bogus")).toBe(false);
    expect(simulatorIntent({ scenario: "normal-night", enabled: true }).payload).toMatchObject({ enabled: true });
  });
  it("holds the 60fps budget under 16.7ms p95", () => {
    expect(withinFrameBudget(12)).toBe(true);
    expect(withinFrameBudget(16.7)).toBe(false);
    expect(withinFrameBudget(20)).toBe(false);
  });
  it("refuses modals while Live is active (spec 144)", () => {
    expect(routeDialogDuringLive(true)).toBe("route-to-status");
    expect(routeDialogDuringLive(false)).toBe("show-dialog");
    expect(isModalAllowed(true)).toBe(false);
    expect(isModalAllowed(false)).toBe(true);
  });
});
