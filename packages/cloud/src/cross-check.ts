// Cloud cross-check in qualification (T-CLD-02, closes F-CLD-01).
//
// When cloud metadata is enabled, qualification compares the cloud-declared
// segment count against the measured count and records any mismatch in the
// device evidence. The measured value always wins: the cloud declaration is
// a hint that flags a record for review, never a value the client writes
// into the calibration.

import type { CloudDevice } from "./client.js";

/** What the wizard measured on this unit (T-GOV-11 calibration record). */
export interface CrossCheckInput {
  hardwareId: string;
  model: string;
  measuredSegmentCount: number;
  cloud: CloudDevice | null;
}

export type SegmentComparison = "agree" | "disagree" | "cloud-silent";

/** What the qualification record keeps. A disagreement never changes the
 *  measured count; it is recorded so the device screen can show it. */
export interface CrossCheckOutcome {
  comparison: SegmentComparison;
  measuredSegmentCount: number;
  declaredSegmentCount: number | null;
  mismatchRecorded: boolean;
  evidenceNote: string;
}

/** Which declaration the qualification keeps. The measured value stands. */
export type QualificationRetention = "measured";

/** Pure comparison of one declared count against one measured count. */
export function compareDeclaredSegments(
  measured: number,
  declared: number | null,
): SegmentComparison {
  if (declared === null) return "cloud-silent";
  return measured === declared ? "agree" : "disagree";
}

/** Qualification cross-check: compare, record, keep the measurement. */
export function crossCheckQualification(input: CrossCheckInput): CrossCheckOutcome {
  const declared = input.cloud?.capabilities.declaredSegmentCount ?? null;
  const comparison = compareDeclaredSegments(input.measuredSegmentCount, declared);
  if (comparison === "agree") {
    return {
      comparison,
      measuredSegmentCount: input.measuredSegmentCount,
      declaredSegmentCount: declared,
      mismatchRecorded: false,
      evidenceNote: `Cloud declares ${declared} segments for ${input.model}; matches the measured count.`,
    };
  }
  if (comparison === "cloud-silent") {
    return {
      comparison,
      measuredSegmentCount: input.measuredSegmentCount,
      declaredSegmentCount: null,
      mismatchRecorded: false,
      evidenceNote: `Cloud declares no segment count for ${input.model}; measured count stands.`,
    };
  }
  return {
    comparison,
    measuredSegmentCount: input.measuredSegmentCount,
    declaredSegmentCount: declared,
    mismatchRecorded: true,
    evidenceNote:
      `Cloud declares ${declared} segments for ${input.model} but the wizard ` +
      `measured ${input.measuredSegmentCount}. Measured count kept; mismatch recorded.`,
  };
}
