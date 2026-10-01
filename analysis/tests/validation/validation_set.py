"""Validation-set scaffolding (T-QA-09, spec 116, probe P-116-validation-set).

Manifest lives at qa/validation-set.yaml (audio never committed). This module
validates the manifest shape, checks per-category minimums from
qa.validation.minPerCategory, and renders a pre-filled per-track review sheet
covering the spec 116 aspects. Needs owner tracks (OD-10): until the owner
confirms picks, every entry stays a candidate and coverage fails honestly.
"""

from __future__ import annotations

import pathlib

import yaml

CATEGORIES = [
    "house", "tech-house", "edm", "bass-music", "hip-hop", "pop", "rock",
    "disco", "fake-drops", "long-breakdowns", "tempo-changes", "weak-intros",
    "irregular-structure",
]

ASPECTS = [
    "structure", "drop timing", "restraint", "recurrence", "contrast",
    "colour coherence", "spatial behaviour", "transition handling",
]

MANIFEST = pathlib.Path(__file__).resolve().parents[3] / "qa" / "validation-set.yaml"

def load_manifest(path: pathlib.Path = MANIFEST) -> dict:
    with open(path) as f:
        data = yaml.safe_load(f)
    assert isinstance(data, dict), "manifest must be a mapping"
    assert data.get("categories") == CATEGORIES, "manifest categories must match spec 116"
    assert isinstance(data.get("tracks"), list), "manifest tracks must be a list"
    return data


def coverage(tracks: list[dict], min_per: int = 3) -> dict[str, int]:
    counts = {c: 0 for c in CATEGORIES}
    for t in tracks:
        if t.get("status") == "confirmed" and t.get("category") in counts:
            counts[t["category"]] += 1
    return counts


def missing_categories(tracks: list[dict], min_per: int = 3) -> list[str]:
    return [c for c, n in coverage(tracks, min_per).items() if n < min_per]


def review_sheet(track_id: str, category: str) -> str:
    lines = [f"# Review: {track_id} ({category})", "",
             "Render: waveform plus sections plus events plus preview side by side,",
             "plus spec 115 diagnostics, on the owner venue or the reference room.", ""]
    for aspect in ASPECTS:
        lines += [f"## {aspect}", "", "- observation:", "- verdict: pass / fail:", ""]
    lines += ["## Re-render needed?", "", "- no / yes (note the planner fix and re-review):"]
    return "\n".join(lines) + "\n"
