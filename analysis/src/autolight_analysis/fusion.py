"""Native/ML fusion with provenance (§19). Native grid always wins timing."""
from __future__ import annotations

from autolight_analysis.metrical import grid_warning as grid_warning


def fuse(label: str, evidence: list[str], confidence: float) -> dict:
    return {"type": label, "evidence": evidence, "confidence": confidence}


# Contract mirror: TS trackModelSchema owns truth; keep field-by-field parity.
# sections: kind/rawLabel/startBeat/endBeat/confidence (no evidence field).
# musicalEvents: type/beat/endBeat?/confidence/strength?.
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
    """Assemble immutable versioned TrackModel (§20)."""
    if coverage not in ("full", "structured", "adaptive"):
        raise ValueError(f"coverage={coverage}")
    sections = [
        {
            "kind": p["kind"],
            "startBeat": p["startBeat"],
            "endBeat": p["endBeat"],
            "confidence": p.get("confidence", 0.8),
            **({"rawLabel": p["rawLabel"]} if p.get("rawLabel") else {}),
        }
        for p in phrases
    ]
    events = [
        {
            "type": e["type"],
            "beat": e["beat"],
            "confidence": e.get("confidence", 0.8),
            **({"endBeat": e["endBeat"]} if e.get("endBeat") is not None else {}),
            **({"strength": e["strength"]} if e.get("strength") is not None else {}),
        }
        for e in musical_events
    ]
    return {
        "schemaVersion": 1,
        "analyzerVersion": analyzer_version,
        "identity": {"id": track_id, "sourceIds": {}},
        "durationSeconds": duration_seconds,
        "beatGrid": {"version": 1, "beats": beat_grid},
        "sections": sections,
        "musicalEvents": events,
        "analysisCoverage": coverage,
    }
