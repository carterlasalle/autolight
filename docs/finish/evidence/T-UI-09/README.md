# T-UI-09: Setup experience

Closes F-UI-10 (setup part), F-APP-08 (UI), F-FLX-05 (UI). Spec 100
(wp13-ui.md T-UI-09).

## What changed

- `features/setup/setup-view.tsx`: kept the LiveSetupAssist
  `RkbxSetupAssistant` import and the derived `done` list untouched; added a
  Simulator card (scenario picker over the five T-UI-15 scenarios plus
  enter/exit sending `simulator/mode` with scenario) and an evidence Check
  button per step backed by `setupProgress` (steps count done only with
  evidence; progress line reads "N of 10 with evidence").
- The ten steps render from the shared `SETUP_STEPS` (dj, controller,
  library, lights, identify, placement, orientation, qualification,
  analysis, preview); DJ-software auto-detect, controller status, and the
  live source assistant remain owned by their slices and surface through the
  existing cards.

## Proof

- `device-screens.test.ts` setup row: empty evidence starts at dj, two
  checks list dj+controller, full evidence reads ready.
- Routes test still renders "Follow mode"; owned run 15 files, 83 passed.
- Fresh-profile ten-step E2E (P-100) and both-apps-detected (P-136) need the
  packaged app; this task proves evidence gating plus simulator wiring.

## Delete test

- Render steps from `done` alone and evidence adds nothing (the "with
  evidence" count row goes red once pinned); drop `scenario` from the
  simulator intent and the T-UI-15 intent row goes red.

## Seams

- `rkbx-setup-panel.tsx` plus test: LiveSetupAssist. Step checks that need
  real hardware (lights, identify, qualification) stay manual Check buttons
  here; automatic evidence arrives with each owner slice.
