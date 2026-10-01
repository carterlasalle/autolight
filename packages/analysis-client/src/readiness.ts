// Capability accounting shared with Python (T-ANA-15, spec 70, spec 137).
// Mirror of analysis/src/autolight_analysis/readiness.py: same key order and
// level rules. Keep both sides in step by hand; the drift test
// (analysis/tests/test_readiness.py::test_ts_mirror_in_sync) fails otherwise.
export const INPUT_KEYS = [
  "source.audio",
  "native.rekordbox.grid",
  "native.rekordbox.pssi",
  "native.rekordbox.cues",
  "native.rekordbox.waveforms",
  "native.rekordbox.vocal",
  "native.serato.grid",
  "native.serato.markers",
  "ml.allinone.structure",
  "ml.allinone.metrical",
  "ml.allinone.activations",
  "ml.allinone.embeddings",
  "ml.stems",
  "ml.beatthis",
  "dsp.features",
  "dsp.stemProxies",
  "events.detectors",
  "fusion.structure",
  "plan.generated",
] as const;

export type InputKey = (typeof INPUT_KEYS)[number];
export type InputStatus = "present" | "absent" | "failed" | "skipped";
export interface InputEntry {
  status: InputStatus;
  reason?: string;
  version?: string;
  durationMs?: number;
}
export type InputMap = Record<InputKey, InputEntry>;
export type Coverage = "full" | "structured" | "adaptive";

function statusOf(inputs: Partial<Record<InputKey, InputEntry>>, key: InputKey): InputStatus {
  return inputs[key]?.status ?? "absent";
}

/** Readiness from the input map only, mirroring readiness.py (never by hand). */
export function computeReadiness(inputs: Partial<Record<InputKey, InputEntry>>): Coverage {
  const hasGrid =
    statusOf(inputs, "native.rekordbox.grid") === "present" ||
    statusOf(inputs, "native.serato.grid") === "present";
  const hasAudio = statusOf(inputs, "source.audio") === "present";
  const hasNativeStructure =
    statusOf(inputs, "native.rekordbox.pssi") === "present" ||
    statusOf(inputs, "native.serato.markers") === "present" ||
    statusOf(inputs, "fusion.structure") === "present";
  const hasMl = statusOf(inputs, "ml.allinone.structure") === "present";
  const hasDsp = statusOf(inputs, "dsp.features") === "present";
  const hasEvents = statusOf(inputs, "events.detectors") === "present";
  const hasPlan = statusOf(inputs, "plan.generated") === "present";
  if (hasGrid && hasAudio && hasNativeStructure && hasMl && hasDsp && hasEvents && hasPlan) {
    return "full";
  }
  if (hasGrid && hasNativeStructure) return "structured";
  return "adaptive";
}

/** Ordered click-through rows for the Library Inspector (spec 137). */
export function describeInputs(inputs: Partial<Record<InputKey, InputEntry>>): { key: InputKey; status: InputStatus; reason?: string }[] {
  return INPUT_KEYS.map((key) => ({
    key,
    status: statusOf(inputs, key),
    reason: inputs[key]?.reason,
  }));
}
