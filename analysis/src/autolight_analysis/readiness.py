"""Capability accounting for analysis artifacts (T-ANA-15, spec 70, spec 137).

Every artifact carries ``analysisCoverage.inputs``: one entry per key below,
each ``{status, reason?, version?, durationMs?}``. Readiness is computed only
from this list, in one shared function, and is never set by hand.

Shared with TypeScript through generated code: ``readiness.ts`` in
``packages/analysis-client/src`` is generated from INPUT_KEYS below (same key
order, same level rules). The generator is ``tools/gen-readiness.mjs`` and CI
fails on drift (checked by ``test_readiness.py::test_ts_mirror_in_sync``).
"""

from __future__ import annotations

INPUT_KEYS: tuple[str, ...] = (
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
)

PRESENT = "present"
ABSENT = "absent"
FAILED = "failed"
SKIPPED = "skipped"


def input_entry(status: str, reason: str = "", version: str = "",
                duration_ms: float = 0.0) -> dict:
    entry: dict = {"status": status}
    if reason:
        entry["reason"] = reason
    if version:
        entry["version"] = version
    if duration_ms:
        entry["durationMs"] = duration_ms
    return entry


def blank_inputs(reason_audio: str = "not attempted") -> dict[str, dict]:
    """All-absent input map; the worker flips entries as stages complete."""
    out = {key: input_entry(ABSENT, "not attempted") for key in INPUT_KEYS}
    out["source.audio"] = input_entry(ABSENT, reason_audio)
    return out


def _get(inputs: dict, key: str) -> str:
    entry = inputs.get(key)
    if not isinstance(entry, dict):
        return ABSENT
    return entry.get("status", ABSENT)


def compute_readiness(inputs: dict) -> str:
    """Level from the input map only (T-ANA-15). Never set by hand.

    FULL: DJ grid + source.audio + at least one native structure input +
    ml.allinone.structure + dsp.features + events.detectors + plan.generated.
    STRUCTURED: DJ grid + native structure (PSSI), without accessible audio
    or without ML. ADAPTIVE: everything else.
    """
    has_grid = _get(inputs, "native.rekordbox.grid") == PRESENT or \
        _get(inputs, "native.serato.grid") == PRESENT
    has_audio = _get(inputs, "source.audio") == PRESENT
    has_native_structure = (
        _get(inputs, "native.rekordbox.pssi") == PRESENT
        or _get(inputs, "native.serato.markers") == PRESENT
        or _get(inputs, "fusion.structure") == PRESENT
    )
    has_ml = _get(inputs, "ml.allinone.structure") == PRESENT
    has_dsp = _get(inputs, "dsp.features") == PRESENT
    has_events = _get(inputs, "events.detectors") == PRESENT
    has_plan = _get(inputs, "plan.generated") == PRESENT
    if (has_grid and has_audio and has_native_structure and has_ml
            and has_dsp and has_events and has_plan):
        return "full"
    if has_grid and has_native_structure:
        return "structured"
    return "adaptive"


def describe_inputs(inputs: dict) -> list[dict]:
    """Ordered click-through rows for the Library Inspector (spec 137)."""
    return [{"key": key, **inputs.get(key, input_entry(ABSENT, "unknown"))}
            for key in INPUT_KEYS]
