import type { Route } from "../../app/store.js";

// Setup evidence steps (T-UI-09, spec 100): canonical home for the ten
// steps plus evidence gating. device-screens.ts re-exports these so the
// Venue screen and Setup screen share one definition.

export const SETUP_EVIDENCE_STEPS = [
  "dj", "controller", "library", "lights", "identify",
  "placement", "orientation", "qualification", "analysis", "preview",
] as const;
export type EvidenceStep = (typeof SETUP_EVIDENCE_STEPS)[number];

export function setupProgress(evidence: Partial<Record<EvidenceStep, boolean>>): { done: EvidenceStep[]; next: EvidenceStep | "ready" } {
  const done = SETUP_EVIDENCE_STEPS.filter((s) => evidence[s] === true);
  const next = SETUP_EVIDENCE_STEPS.find((s) => evidence[s] !== true) ?? "ready";
  return { done, next };
}

// Human-facing step copy plus the screen that unblocks each step. The slug
// stays the machine key; the label is what a first-run user reads.
export interface SetupStepInfo {
  id: EvidenceStep;
  label: string;
  detail: string;
  route: Route;
}

export const SETUP_STEP_INFO: Record<EvidenceStep, SetupStepInfo> = {
  dj: { id: "dj", label: "Connect DJ software", detail: "Rekordbox or Serato with a track on a deck", route: "setup" },
  controller: { id: "controller", label: "Point at the controller", detail: "AX or PRO DJ LINK beat source", route: "setup" },
  library: { id: "library", label: "Resolve the library", detail: "ANLZ grid for the loaded track", route: "library" },
  lights: { id: "lights", label: "Find the lights", detail: "Scan the LAN for Govee fixtures", route: "venue" },
  identify: { id: "identify", label: "Identify each light", detail: "Run IDENTIFY so the tile maps to a fixture", route: "venue" },
  placement: { id: "placement", label: "Place the lights", detail: "Drag fixtures onto the room plan", route: "venue" },
  orientation: { id: "orientation", label: "Set strip direction", detail: "Which end of the strip faces the room", route: "venue" },
  qualification: { id: "qualification", label: "Qualify the strips", detail: "TEST CHASE confirms segments and latency", route: "venue" },
  analysis: { id: "analysis", label: "Analyze the track", detail: "Sections, events, and cues for the planner", route: "library" },
  preview: { id: "preview", label: "Preview the show", detail: "The compiled plan renders in the room", route: "live" },
};

export interface SetupEvidenceInput {
  showLoaded: boolean;
  devicesFound: number;
  tilesQualified: number;
}

// Evidence comes from measured state only: a step is ready when a real signal
// proves it, never from a manual check-off. Steps with no measured signal
// (controller, placement, orientation) stay pending rather than being marked
// done optimistically.
export function setupEvidence(input: SetupEvidenceInput): Partial<Record<EvidenceStep, boolean>> {
  const show = input.showLoaded;
  const lights = input.devicesFound > 0;
  const qualified = input.tilesQualified > 0;
  return {
    dj: show,
    library: show,
    analysis: show,
    preview: show,
    lights,
    identify: qualified,
    qualification: qualified,
  };
}
