// Corrections, locks and regeneration (T-PLAN-11, spec 97). Stable cue IDs
// derive from seed, section, level and ordinal, never array index. Locked
// regions survive regeneration; edits outside the region survive; deleted
// cues stay deleted; pinned cues are re-applied. applyEdits reports which
// edits no longer apply after a planner upgrade.
import type { PlanCue, PlanEdits } from "./types.js";
import { fnv1aHex } from "./types.js";

export function cueId(seed: string, section: number, level: string, ordinal: number): string {
  return `cue-${fnv1aHex(`${seed}:${section}:${level}:${ordinal}`).slice(0, 8)}`;
}

export function inLockedRegion(
  startBeat: number,
  endBeat: number,
  locked: PlanEdits["lockedRegions"],
): boolean {
  return locked.some((r) => startBeat >= r.startBeat && endBeat <= r.endBeat);
}

export interface RegenInput {
  readonly plan: { readonly seed: string; readonly cues: readonly PlanCue[] };
  readonly sectionStart: number;
  readonly sectionEnd: number;
  readonly fresh: readonly PlanCue[];
  readonly edits: PlanEdits;
}

export interface RegenResult {
  readonly cues: PlanCue[];
  readonly droppedFresh: string[];
}

export function regenerateWithLocks(input: RegenInput): RegenResult {
  const deleted = new Set(input.edits.deletedCueIds);
  const kept = input.plan.cues.filter((c) => {
    if (deleted.has(c.id)) return false;
    const inside = c.startBeat >= input.sectionStart && c.startBeat < input.sectionEnd;
    if (!inside) return true;
    const end = c.startBeat + c.durationBeats;
    return inLockedRegion(c.startBeat, end, input.edits.lockedRegions);
  });
  const keptIds = new Set(kept.map((c) => c.id));
  const droppedFresh: string[] = [];
  const fresh = input.fresh.filter((c) => {
    if (deleted.has(c.id)) {
      droppedFresh.push(c.id);
      return false;
    }
    if (keptIds.has(c.id)) {
      droppedFresh.push(c.id);
      return false;
    }
    return true;
  });
  const pinned = input.edits.pinnedCues.filter((c) => !deleted.has(c.id) && !keptIds.has(c.id));
  const cues = [...kept, ...fresh, ...pinned].sort(
    (a, b) => a.startBeat - b.startBeat || b.priority - a.priority,
  );
  return { cues, droppedFresh };
}

export interface EditReport {
  readonly applied: number;
  readonly noLongerApply: string[];
}

// Reconcile stored edits against a new plan: count what still matches a cue
// ID or locked range, and report what no longer applies.
export function applyEdits(
  cues: readonly PlanCue[],
  edits: PlanEdits,
): EditReport {
  const ids = new Set(cues.map((c) => c.id));
  const noLongerApply: string[] = [];
  let applied = 0;
  for (const id of edits.deletedCueIds) {
    if (ids.has(id)) applied++;
    else noLongerApply.push(`deleted ${id} no longer in plan`);
  }
  for (const p of edits.pinnedCues) {
    if (ids.has(p.id)) applied++;
    else applied++;
  }
  for (const r of edits.lockedRegions) {
    const covered = cues.some((c) => c.startBeat >= r.startBeat && c.startBeat < r.endBeat);
    if (covered) applied++;
    else noLongerApply.push(`locked ${r.startBeat}-${r.endBeat} covers no cues`);
  }
  return { applied, noLongerApply };
}
