// Segment resolution selection (T-GOV-15, closes F-GOV-28; spec 53, DS-20).
//
// Provenance: govee-toolkit MIT (Damien Thery, v0.5.0) docs/protocol/lan.md
// section 1 (frame rate ceiling falls with zone count; unmeasured units fall
// back to 10 Hz) and section 2.3 (native resolution by changepoint sweep);
// 03-config-and-decisions.md DS-20 (`logical`, `grouped`, `native`, `auto`)
// and `govee.lan.stream.targetHz`.
//
// Offer logical (the count the Govee app exposes, confirmed per unit by the
// wizard's step 9 stripe count), grouped (a divisor chosen for stability) and
// native (measured N). `auto` picks the highest that is confirmed, stable and
// meets the refresh target. The decision carries its reason so the UI can
// show why (DoD: SIM test where native is too slow and auto picks grouped).
export type ResolutionKind = "logical" | "grouped" | "native";
export type ResolutionMode = ResolutionKind | "auto";

export interface ResolutionInput {
  logical: number | null;
  native: number | null;
  grouped?: readonly number[];
  stableFpsFor: (zones: number) => number;
  targetHz: number;
  mode?: ResolutionMode;
}

export interface ResolutionCandidate {
  kind: ResolutionKind;
  zones: number;
  stableFps: number;
  meetsTarget: boolean;
}

export interface ResolutionDecision {
  kind: ResolutionKind;
  zones: number;
  stableFps: number;
  meetsTarget: boolean;
  reason: string;
  candidates: ResolutionCandidate[];
}

export function selectResolution(input: ResolutionInput): ResolutionDecision {
  const mode = input.mode ?? "auto";
  const target = Math.max(1, Math.floor(input.targetHz));
  const byKind: Partial<Record<ResolutionKind, number>> = {};
  if (typeof input.logical === "number" && input.logical > 0) {
    byKind.logical = Math.floor(input.logical);
  }
  const native = typeof input.native === "number" && input.native > 0 ? Math.floor(input.native) : null;
  let grouped: number[] = [];
  if (input.grouped !== undefined && input.grouped.length > 0) {
    grouped = [...new Set(input.grouped.map((v) => Math.floor(v)).filter((v) => v > 0))].sort((a, b) => b - a);
  } else if (native !== null && native > 2) {
    for (let d = Math.floor(native / 2); d >= 2; d--) {
      if (native % d === 0) grouped.push(d);
    }
  }
  const head = grouped[0];
  if (head !== undefined) byKind.grouped = head;
  if (native !== null) byKind.native = native;
  if (byKind.logical === undefined && byKind.grouped === undefined && byKind.native === undefined) {
    throw new RangeError("selectResolution needs at least one confirmed count (logical or native)");
  }
  const rows: { kind: ResolutionKind; zones: number }[] = [];
  if (byKind.native !== undefined) rows.push({ kind: "native", zones: byKind.native });
  for (const zones of grouped) {
    if (zones !== byKind.native && zones !== byKind.logical) rows.push({ kind: "grouped", zones });
  }
  if (byKind.grouped !== undefined && !rows.some((r) => r.kind === "grouped")) {
    rows.push({ kind: "grouped", zones: byKind.grouped });
  }
  if (byKind.logical !== undefined && !rows.some((r) => r.zones === byKind.logical)) {
    rows.push({ kind: "logical", zones: byKind.logical });
  }
  const candidates: ResolutionCandidate[] = rows.map((row) => {
    const stableFps = input.stableFpsFor(row.zones);
    return { kind: row.kind, zones: row.zones, stableFps, meetsTarget: stableFps >= target };
  }).sort((a, b) => b.zones - a.zones);
  if (mode !== "auto") {
    const want = byKind[mode];
    const pick = candidates.find((c) => c.kind === mode)
      ?? (want !== undefined ? candidates.find((c) => c.zones === want) : undefined);
    if (!pick) throw new RangeError(`resolution ${mode} has no confirmed zone count`);
    return {
      ...pick,
      reason: `${mode} ${pick.zones} zones at ${pick.stableFps} Hz stable (target ${target} Hz${pick.meetsTarget ? ", meets target" : ", below target, explicit choice"})`,
      candidates,
    };
  }
  const meets = candidates.filter((c) => c.meetsTarget);
  if (meets.length > 0) {
    const pick = meets[0]!;
    const top = candidates[0]!;
    const context = pick.zones !== top.zones
      ? ` (native ${top.zones} zones at ${top.stableFps} Hz stable is below target ${target} Hz)`
      : "";
    return {
      ...pick,
      reason: `${pick.kind} ${pick.zones} zones at ${pick.stableFps} Hz stable meets target ${target} Hz (highest count that does)${context}`,
      candidates,
    };
  }
  const fallback = [...candidates].sort((a, b) => b.stableFps - a.stableFps || a.zones - b.zones)[0]!;
  const top = candidates[0]!;
  return {
    ...fallback,
    reason: `native ${top.zones} zones at ${top.stableFps} Hz stable is below target ${target} Hz; picked ${fallback.kind} ${fallback.zones} zones at ${fallback.stableFps} Hz stable instead`,
    candidates,
  };
}
