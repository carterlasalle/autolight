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

// Evidence collector (T-UI-09): one pure function from measured inputs to
// the ten steps, so the screen is a thin binder and the mapping is unit
// pinned. Steps with no renderer-side evidence source stay pending: the
// checklist must never report readiness it cannot observe.
export interface SetupInputs {
  live: { deckA: { title: string }; deckB: { title: string }; cues: unknown[]; cells: unknown[] } | null;
  devices: unknown[];
  tiles: { id: string; firmware: string }[];
  identifiedIds: string[];
  chasePassedIds: string[];
  roomSaved: boolean;
}

export function setupEvidence(inputs: SetupInputs): Partial<Record<EvidenceStep, boolean>> {
  const { live, devices, tiles, roomSaved } = inputs;
  // dj = transport flowing (a show/live response arrived); library = track
  // identities resolved (a non-empty track list). They coincide while only
  // deck A can carry a track, but they test different projections.
  const titles = live === null ? [] : [live.deckA.title, live.deckB.title].filter((t) => t !== "—");
  const identified = new Set(inputs.identifiedIds);
  const chased = new Set(inputs.chasePassedIds);
  return {
    dj: live !== null,
    controller: false,
    library: titles.length > 0,
    lights: devices.length > 0,
    identify: tiles.some((t) => t.firmware !== "unknown" || identified.has(t.id)),
    placement: roomSaved,
    orientation: roomSaved,
    qualification: tiles.length > 0 && tiles.every((t) => chased.has(t.id)),
    analysis: live !== null && live.cues.length > 0,
    preview: live !== null && live.cells.length > 0,
  };
}
