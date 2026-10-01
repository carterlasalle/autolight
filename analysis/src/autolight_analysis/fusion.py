"""Native/ML fusion with provenance (T-ANA-11, spec 19, DS-11).

Timing comes from the DJ grid; structure fuses PSSI plus All-In-One boundary
and label probabilities plus feature boundaries plus event detector output,
weighted by DS-11 (``pssi-first``, ``ml-first``, ``fused`` default). When
PSSI is absent, All-In-One labels form sections (F-ANA-27). Confidence comes
from agreement and source probabilities, not constants. Every section, phrase
and event carries ``evidence[]`` with source tags (``rekordbox:PSSI:Up``,
``allin1:boundary``, ``energy:rising``). No bare ``except``: named exceptions
feed input status entries (F-ANA-01).
"""

from __future__ import annotations

STRUCTURE_MODES = ("pssi-first", "ml-first", "fused")

# Contract mirror: TS trackModelSchema owns truth; keep field-by-field parity.
# sections: kind/rawLabel/startBeat/endBeat/confidence/evidence (evidence kept:
# F-ANA-17 stripped it; T-ANA-12 carries it in the schema).
# musicalEvents: type/beat/endBeat?/confidence/strength?/evidence.


def fuse(label: str, evidence: list[str], confidence: float) -> dict:
    return {"type": label, "evidence": evidence, "confidence": confidence}


def fuse_sections(pssi_sections: list[dict], ml_sections_list: list[dict],
                  feature_boundaries: list[int] | None = None,
                  mode: str = "fused") -> list[dict]:
    """Fuse PSSI and ML sections per DS-11 mode (T-ANA-11).

    ``fused`` (default): union of boundaries, confidence from agreement and
    source probabilities. ``pssi-first``: PSSI spans win, ML corroborates.
    ``ml-first``: ML spans win, PSSI corroborates. PSSI absent means ML labels
    form sections directly (F-ANA-27).
    """
    if mode not in STRUCTURE_MODES:
        raise ValueError(f"structure mode={mode!r}")
    ml_sections_list = ml_sections_list or []
    boundaries = set(feature_boundaries or [])
    if not pssi_sections:
        return [{**s, "confidence": min(1.0, s.get("confidence", 0.5) + 0.05),
                 "evidence": [*s.get("evidence", []), "ml:only-source"]}
                for s in ml_sections_list]
    if not ml_sections_list:
        return [{**s, "evidence": [*s.get("evidence", []), "native:only-source"]}
                for s in pssi_sections]
    if mode == "pssi-first":
        return [_with(s, extra=["allin1:corroborated"]
                      if _overlaps(s, ml_sections_list) else ["allin1:absent"],
                      boost=0.1 if _overlaps(s, ml_sections_list) else -0.1)
                for s in pssi_sections]
    if mode == "ml-first":
        return [_with(s, extra=["rekordbox:PSSI:corroborated"]
                      if _overlaps(s, pssi_sections) else ["rekordbox:PSSI:absent"],
                      boost=0.1 if _overlaps(s, pssi_sections) else -0.1)
                for s in ml_sections_list]
    # fused: union of boundary sets, confidence from agreement.
    out = []
    for s in pssi_sections:
        agree = _overlaps(s, ml_sections_list)
        near_feature = any(abs(s["startBeat"] - b) <= 2 for b in boundaries)
        ev = [*s.get("evidence", [])]
        if agree:
            ev.append("allin1:boundary")
        if near_feature:
            ev.append("energy:boundary")
        conf = min(1.0, max(0.0, s.get("confidence", 0.5)
                             + (0.15 if agree else 0.0)
                             + (0.05 if near_feature else 0.0)))
        out.append({**s, "confidence": conf, "evidence": ev})
    for s in ml_sections_list:
        if not any(_spans_overlap(s, p) for p in pssi_sections):
            out.append({**s, "evidence": [*s.get("evidence", []),
                                          "fused:ml-only-span"]})
    return sorted(out, key=lambda s: s["startBeat"])


def _with(section: dict, extra: list[str], boost: float) -> dict:
    return {**section,
            "confidence": min(1.0, max(0.0, section.get("confidence", 0.5) + boost)),
            "evidence": [*section.get("evidence", []), *extra]}


def _spans_overlap(a: dict, b: dict) -> bool:
    return a["startBeat"] < b["endBeat"] and b["startBeat"] < a["endBeat"]


def _overlaps(section: dict, others: list[dict]) -> bool:
    return any(_spans_overlap(section, o) for o in others)


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
    inputs: dict | None = None,
    grid_warnings: list[dict] | None = None,
    beat_features: list[dict] | None = None,
    frame_features_ref: dict | None = None,
    key: dict | None = None,
) -> dict:
    """Assemble immutable versioned TrackModel (§20)."""
    from autolight_analysis.readiness import blank_inputs, compute_readiness

    if coverage not in ("full", "structured", "adaptive"):
        raise ValueError(f"coverage={coverage}")
    sections = [
        {
            "kind": p["kind"],
            "startBeat": p["startBeat"],
            "endBeat": p["endBeat"],
            "confidence": p.get("confidence", 0.8),
            **({"rawLabel": p["rawLabel"]} if p.get("rawLabel") else {}),
            **({"evidence": p["evidence"]} if p.get("evidence") else {}),
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
            **({"evidence": e["evidence"]} if e.get("evidence") else {}),
            **({"fakeImpactBeat": e["fakeImpactBeat"]}
               if e.get("fakeImpactBeat") is not None else {}),
            **({"actualImpactBeat": e["actualImpactBeat"]}
               if e.get("actualImpactBeat") is not None else {}),
        }
        for e in musical_events
    ]
    inputs = inputs if inputs is not None else blank_inputs()
    level = compute_readiness(inputs)
    return {
        "schemaVersion": 2,
        "analyzerVersion": analyzer_version,
        "identity": {"id": track_id, "sourceIds": {}},
        "durationSeconds": duration_seconds,
        "beatGrid": {"version": 1, "beats": beat_grid},
        "sections": sections,
        "musicalEvents": events,
        "analysisCoverage": coverage,
        "readinessLevel": level,
        "gridWarnings": grid_warnings or [],
        "beatFeatures": beat_features or [],
        **({"frameFeatures": frame_features_ref} if frame_features_ref else {}),
        **({"musicalKey": key} if key else {}),
        "analysisCoverage2": {"level": level, "inputs": inputs},
    }
