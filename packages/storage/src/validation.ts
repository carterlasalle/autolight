import {
  beatGridSchema,
  fixtureSchema,
  showPlanSchema,
  trackModelSchema,
  type BeatGrid,
} from "@autolight/contracts";

// Semantic validation of contracts (T-DATA-05, F-DATA-05).
// Zod schemas prove shape at parse time; these refinements prove meaning:
// beats strictly increasing and unique; ranges ordered; events inside the
// beat range; segment counts consistent between device, calibration and
// cell map; cue durations positive; section cover without gaps or overlaps.
// Run at every trust boundary: worker output, DB read, IPC input.

export interface ValidationIssue {
  path: string;
  message: string;
}

function beatRangeOf(grid: BeatGrid): { lo: number; hi: number } {
  const beats = grid.beats;
  return { lo: beats[0]!.index, hi: beats[beats.length - 1]!.index };
}

export function validateBeats(grid: unknown): ValidationIssue[] {
  const parsed = beatGridSchema.safeParse(grid);
  if (!parsed.success) {
    return parsed.error.issues.map((i) => ({
      path: `beatGrid.${i.path.join(".")}`,
      message: i.message,
    }));
  }
  const issues: ValidationIssue[] = [];
  const beats = parsed.data.beats;
  for (let i = 1; i < beats.length; i++) {
    const prev = beats[i - 1]!;
    const cur = beats[i]!;
    if (!(cur.index > prev.index)) {
      issues.push({
        path: `beatGrid.beats[${i}].index`,
        message: `beat index not strictly increasing: ${prev.index} then ${cur.index}`,
      });
    }
    if (!(cur.sourceTimeMs > prev.sourceTimeMs)) {
      issues.push({
        path: `beatGrid.beats[${i}].sourceTimeMs`,
        message: `beat time not strictly increasing at index ${cur.index}`,
      });
    }
  }
  return issues;
}

function sectionBounds(s: object): { start: unknown; end: unknown } {
  const start = "startBeat" in s ? s.startBeat : undefined;
  const end = "endBeat" in s ? s.endBeat : undefined;
  return { start, end };
}

export function validateSections(sections: unknown, grid: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!Array.isArray(sections)) {
    return [{ path: "sections", message: "sections must be an array" }];
  }
  const gridParsed = beatGridSchema.safeParse(grid);
  const range = gridParsed.success ? beatRangeOf(gridParsed.data) : null;
  const rows: { start: number; end: number; i: number }[] = [];
  sections.forEach((s, i) => {
    if (typeof s !== "object" || s === null || Array.isArray(s)) {
      issues.push({ path: `sections[${i}]`, message: "section must be an object" });
      return;
    }
    const { start, end } = sectionBounds(s);
    if (typeof start !== "number" || !Number.isFinite(start) || typeof end !== "number" || !Number.isFinite(end)) {
      issues.push({ path: `sections[${i}]`, message: "section needs numeric startBeat and endBeat" });
      return;
    }
    if (!(start < end)) {
      issues.push({
        path: `sections[${i}].endBeat`,
        message: `section range not ordered: startBeat ${start} endBeat ${end}`,
      });
    }
    rows.push({ start, end, i });
  });
  const ordered = [...rows].sort((a, b) => a.start - b.start);
  for (let k = 1; k < ordered.length; k++) {
    const prev = ordered[k - 1]!;
    const cur = ordered[k]!;
    if (cur.start < prev.end) {
      issues.push({
        path: `sections[${cur.i}].startBeat`,
        message: `section overlaps previous: starts ${cur.start} before ${prev.end}`,
      });
    } else if (cur.start > prev.end) {
      issues.push({
        path: `sections[${cur.i}].startBeat`,
        message: `section cover has gap: starts ${cur.start} after ${prev.end}`,
      });
    }
  }
  if (range && rows.length > 0) {
    const minStart = Math.min(...rows.map((r) => r.start));
    const maxEnd = Math.max(...rows.map((r) => r.end));
    if (minStart < range.lo || maxEnd > range.hi) {
      issues.push({
        path: "sections",
        message: `section cover [${minStart}, ${maxEnd}] exceeds beat range [${range.lo}, ${range.hi}]`,
      });
    }
  }
  return issues;
}

function eventBounds(e: object): { beat: unknown; end: unknown } {
  const beat = "beat" in e ? e.beat : undefined;
  const end = "endBeat" in e ? e.endBeat : undefined;
  return { beat, end: end === undefined ? beat : end };
}

export function validateEvents(events: unknown, grid: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!Array.isArray(events)) {
    return [{ path: "musicalEvents", message: "musicalEvents must be an array" }];
  }
  const gridParsed = beatGridSchema.safeParse(grid);
  const range = gridParsed.success ? beatRangeOf(gridParsed.data) : null;
  events.forEach((e, i) => {
    if (typeof e !== "object" || e === null || Array.isArray(e)) {
      issues.push({ path: `musicalEvents[${i}]`, message: "event must be an object" });
      return;
    }
    const { beat, end } = eventBounds(e);
    if (typeof beat !== "number" || !Number.isFinite(beat)) {
      issues.push({ path: `musicalEvents[${i}].beat`, message: "event needs a numeric beat" });
      return;
    }
    if (typeof end !== "number" || !Number.isFinite(end)) {
      issues.push({ path: `musicalEvents[${i}].endBeat`, message: "event endBeat must be numeric" });
      return;
    }
    if (end < beat) {
      issues.push({
        path: `musicalEvents[${i}].endBeat`,
        message: `event ends before it starts: beat ${beat} endBeat ${end}`,
      });
    }
    if (range && (beat < range.lo || end > range.hi)) {
      issues.push({
        path: `musicalEvents[${i}].beat`,
        message: `event [${beat}, ${end}] outside beat range [${range.lo}, ${range.hi}]`,
      });
    }
  });
  return issues;
}

export function validateTrackModel(value: unknown): ValidationIssue[] {
  const parsed = trackModelSchema.safeParse(value);
  if (!parsed.success) {
    return parsed.error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    }));
  }
  const model = parsed.data;
  return [
    ...validateBeats(model.beatGrid),
    ...validateSections(model.sections, model.beatGrid),
    ...validateEvents(model.musicalEvents, model.beatGrid),
  ];
}

export function validateShowPlan(value: unknown): ValidationIssue[] {
  const parsed = showPlanSchema.safeParse(value);
  if (!parsed.success) {
    return parsed.error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    }));
  }
  const issues: ValidationIssue[] = [];
  parsed.data.cues.forEach((cue, i) => {
    if (!(cue.durationBeats > 0)) {
      issues.push({
        path: `cues[${i}].durationBeats`,
        message: `cue duration must be positive, got ${cue.durationBeats}`,
      });
    }
  });
  return issues;
}

function cellIndex(c: object): unknown {
  return "index" in c ? c.index : undefined;
}

export function validateFixtureCells(
  cells: unknown,
  calibrationSegmentCount: number | null,
  deviceSegmentCount: number | null,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!Array.isArray(cells)) {
    return [{ path: "cells", message: "cells must be an array" }];
  }
  const seen: Record<number, true> = {};
  cells.forEach((c, i) => {
    if (typeof c !== "object" || c === null || Array.isArray(c)) {
      issues.push({ path: `cells[${i}].index`, message: "cell must be an object" });
      return;
    }
    const index = cellIndex(c);
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0) {
      issues.push({ path: `cells[${i}].index`, message: "cell index must be a non-negative integer" });
      return;
    }
    if (seen[index] === true) {
      issues.push({ path: `cells[${i}].index`, message: `duplicate cell index ${index}` });
    }
    seen[index] = true;
  });
  const counts: ReadonlyArray<readonly [string, number | null]> = [
    ["calibration.segmentCount", calibrationSegmentCount],
    ["device.segmentCount", deviceSegmentCount],
  ];
  for (const [label, count] of counts) {
    if (count !== null && count !== cells.length) {
      issues.push({
        path: label,
        message: `${label} ${count} disagrees with cell map length ${cells.length}`,
      });
    }
  }
  return issues;
}

export function validateFixture(value: unknown, deviceSegmentCount: number | null = null): ValidationIssue[] {
  const parsed = fixtureSchema.safeParse(value);
  if (!parsed.success) {
    return parsed.error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    }));
  }
  const fixture = parsed.data;
  return validateFixtureCells(
    fixture.cells,
    fixture.calibration ? fixture.calibration.segmentCount : null,
    deviceSegmentCount,
  );
}

export type BoundaryKind = "track-model" | "show-plan" | "fixture";

export function validateAtBoundary(kind: BoundaryKind, value: unknown): ValidationIssue[] {
  switch (kind) {
    case "track-model":
      return validateTrackModel(value);
    case "show-plan":
      return validateShowPlan(value);
    case "fixture":
      return validateFixture(value);
  }
}
