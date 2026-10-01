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
