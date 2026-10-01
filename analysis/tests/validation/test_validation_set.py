"""Scaffolding tests for the T-QA-09 validation set (spec 116).

Failing-capable: an empty manifest fails coverage; a confirmed track passes
its category; the review sheet covers all eight spec 116 aspects. Needs owner
tracks (OD-10): the suite documents the gap instead of inventing audio.
"""

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from validation_set import (
    ASPECTS,
    CATEGORIES,
    MANIFEST,
    coverage,
    load_manifest,
    missing_categories,
    review_sheet,
)


def test_manifest_shape_matches_spec_116():
    data = load_manifest()
    assert data["minPerCategory"] == 3
    assert set(data["categories"]) == set(CATEGORIES)
    assert data["tracks"] == []


def test_empty_manifest_misses_every_category():
    assert set(missing_categories([])) == set(CATEGORIES)
    assert all(n == 0 for n in coverage([]).values())


def test_confirmed_tracks_cover_their_category():
    tracks = [
        {"trackId": "a", "category": "house", "status": "confirmed"},
        {"trackId": "b", "category": "house", "status": "confirmed"},
        {"trackId": "c", "category": "house", "status": "confirmed"},
        {"trackId": "d", "category": "house", "status": "candidate"},
    ]
    assert coverage(tracks)["house"] == 3
    assert "house" not in missing_categories(tracks)
    assert "tech-house" in missing_categories(tracks)


def test_review_sheet_covers_all_aspects():
    sheet = review_sheet("demo-track", "house")
    for aspect in ASPECTS:
        assert aspect in sheet
    assert "spec 115" in sheet


def test_render_tool_placeholder_documents_owner_gap():
    # The render tool (video plus pre-filled sheet for one validation track on
    # the reference room) needs owner audio first; this test pins the seam so
    # a future render lands next to the manifest instead of elsewhere.
    assert MANIFEST.exists()
    assert MANIFEST.parent.name == "qa"
