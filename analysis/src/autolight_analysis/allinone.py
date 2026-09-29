"""All-in-one structural ML behind native-wins fusion (§16, §19).

Native PQTZ grid always wins timing; all-in-one contributes structure
probabilities + section labels + downbeat confidence as *evidence* — never a
replacement grid. All-in-one is an optional dependency: absent → native-only,
pipeline unaffected. CPU on macOS per §16 (no MPS in current all-in-one).
NOTE: allin1_infer.analyze() loads the model per call (no persistent session
API upstream) — the worker amortizes this by analyzing preanalysis queues in
one process; per-track cost is accepted for FULL coverage offline.
"""
from __future__ import annotations


def allinone_available() -> bool:
    """True when the optional all-in-one-infer dependency is importable."""
    try:
        import allin1_infer  # noqa: F401
        return True
    except ImportError:
        return False


# Harmonix functional labels → §21 normalized section vocabulary.
HARMONIX_TO_SECTION = {
    "intro": "intro",
    "verse": "verse",
    "chorus": "chorus",
    "bridge": "bridge",
    "outro": "outro",
    "end": "outro",
    "break": "breakdown",
    "build": "build",
    "drop": "drop",
    "inst": "instrumental",
    "solo": "solo",
    "transition": "transition",
    "prechorus": "prechorus",
}

UNKNOWN_KINDS = {"unknown"}


def normalize_ml_label(label: str) -> str:
    """Map an all-in-one/Harmonix segment label to §21 vocabulary."""
    return HARMONIX_TO_SECTION.get(label.strip().lower(), "unknown")


def ml_sections(
    segments: list[dict],
    beat_times: list[float],
    min_confidence: float = 0.0,
) -> list[dict]:
    """Convert ML segments (seconds) to beat-anchored sections with provenance.

    segments: [{start, end, label}] in seconds (allin1_infer Segment fields).
    beat_times: native grid sourceTimeMs/1000 — the only timing truth.
    Returns [{kind, rawLabel, startBeat, endBeat, confidence, evidence}].
    """
    import bisect

    out: list[dict] = []
    for seg in segments:
        label = str(seg.get("label", ""))
        conf = float(seg.get("confidence", 0.5))
        if conf < min_confidence:
            continue
        start = bisect.bisect_left(beat_times, float(seg.get("start", 0.0)))
        end = bisect.bisect_left(beat_times, float(seg.get("end", 0.0)))
        if end <= start:
            continue
        out.append({
            "kind": normalize_ml_label(label),
            "rawLabel": f"allin1:{label}",
            "startBeat": start + 1,
            "endBeat": end + 1,
            "confidence": min(1.0, max(0.0, conf)),
            "evidence": ["allin1:boundary"],
        })
    return out


def analyze_full(audio_path: str, out_dir: str | None = None):
    """Run all-in-one inference; None keeps the pipeline native-only.

    Persistent-session friendly: caller holds no state, allin1_infer caches
    the model session internally across calls in one worker process.
    """
    if not allinone_available():
        return None
    import allin1_infer

    result = allin1_infer.analyze(paths=audio_path, out_dir=out_dir, device="cpu")
    if isinstance(result, list):
        return result[0] if result else None
    return result
