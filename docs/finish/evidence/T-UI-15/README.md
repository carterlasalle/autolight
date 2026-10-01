# T-UI-15: Simulator mode

Closes F-UI-19 (with T-TRU-02). (wp13-ui.md T-UI-15).

## What changed

- `apps/desktop/src/routes/settings/simulator-mode.ts`: the five scenarios
  (normal-night, pitch-loops, two-deck-transition, device-loss, source-loss),
  `isSimulatorScenario` guard, `simulatorIntent` carrying
  `{ version: 1, enabled, scenario }` on `simulator/mode`.
- Title bar plus status bar already badge SIMULATOR from
  `simulatorMode` (T-TRU-02); Setup screen adds the scenario picker plus
  enter/exit. The full production pipeline runs; only sources/sinks swap.

## Proof

- `simulator-mode.test.ts` scenario rows: five names, guard accepts
  device-loss and rejects bogus, intent carries enabled plus scenario.
- Per-scenario E2E plus the normal-night video need the built app; the
  scenario list plus intent shape are this task's proof. Owned run: 15
  files, 83 passed.

## Delete test

- Drop "source-loss" from `SIMULATOR_SCENARIOS` and the five-scenario row
  goes red; drop `scenario` from the intent and the intent row goes red.

## Seams

- Scenario drivers are the protocol simulators (T-QA-04 fault suite plus
  provider sims); the UI only picks and toggles.
