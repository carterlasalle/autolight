// Simulator scenarios and UI perf/a11y guards (T-UI-15, T-UI-13, T-UI-12):
// scenario names shared by Setup + Settings toggles and the simulator/mode
// intent; frame-budget math for the 60fps perf trace; modal-guard helper that
// routes messages to status while Live is active.

export const SIMULATOR_SCENARIOS = [
  "normal-night", "pitch-loops", "two-deck-transition", "device-loss", "source-loss",
] as const;
export type SimulatorScenario = (typeof SIMULATOR_SCENARIOS)[number];

export function isSimulatorScenario(value: string): value is SimulatorScenario {
  return (SIMULATOR_SCENARIOS as readonly string[]).includes(value);
}

export interface SimulatorPick {
  scenario: SimulatorScenario;
  enabled: boolean;
}

export function simulatorIntent(pick: SimulatorPick): { channel: "simulator/mode"; payload: { version: 1; enabled: boolean; scenario: SimulatorScenario } } {
  return { channel: "simulator/mode", payload: { version: 1, enabled: pick.enabled, scenario: pick.scenario } };
}

// p95 frame budget at 60fps: every sample must stay under one frame.
export function withinFrameBudget(p95Ms: number, budgetMs = 16.7): boolean {
  return p95Ms < budgetMs;
}

// No-modal guard (spec 144): while Live is active every dialog request
// becomes a status message; the helper names the routing, never a dialog.
export function routeDialogDuringLive(liveActive: boolean): "show-dialog" | "route-to-status" {
  return liveActive ? "route-to-status" : "show-dialog";
}
