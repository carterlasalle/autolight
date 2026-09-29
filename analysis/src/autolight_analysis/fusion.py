"""Native/ML fusion with provenance (§19). Native grid always wins timing."""
from __future__ import annotations


def fuse(label: str, evidence: list[str], confidence: float) -> dict:
    return {"type": label, "evidence": evidence, "confidence": confidence}


def grid_warning(native_beats: list[float], ml_beats: list[float], tol: float = 0.05) -> bool:
    """True when ML grid disagrees with native → GRID_WARNING, never silent replace (§17)."""
    if not native_beats or not ml_beats:
        return False
    return abs(native_beats[0] - ml_beats[0]) > tol


def build_track_model(
    *,
    track_id: str,
    analyzer_version: str,
    duration_seconds: float,
    beat_grid: list[dict],
    phrases: list[dict],
    musical_events: list[dict],
    coverage: str,
) -> dict:
    """Assemble immutable versioned TrackModel (§20). Sections carry rawLabel + provenance."""
    if coverage not in ("full", "structured", "adaptive"):
        raise ValueError(f"coverage={coverage}")
    return {
        "schemaVersion": 1,
        "analyzerVersion": analyzer_version,
        "identity": {"id": track_id, "sourceIds": {}},
        "durationSeconds": duration_seconds,
        "beatGrid": {"version": 1, "beats": beat_grid},
        "sections": [
            {
                "kind": p["kind"],
                "rawLabel": p.get("rawLabel"),
                "startBeat": p["startBeat"],
                "endBeat": p["endBeat"],
                "confidence": p.get("confidence", 0.8),
                "evidence": p.get("evidence", ["rekordbox:PSSI"]),
            }
            for p in phrases
        ],
        "musicalEvents": musical_events,
        "analysisCoverage": coverage,
    }
