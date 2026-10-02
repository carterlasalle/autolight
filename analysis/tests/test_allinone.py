from autolight_analysis.allinone import (
    allinone_available,
    ml_sections,
    normalize_ml_label,
)


def test_label_mapping_covers_section_vocab():
    assert normalize_ml_label("intro") == "intro"
    assert normalize_ml_label("Verse") == "verse"
    assert normalize_ml_label("CHORUS") == "chorus"
    assert normalize_ml_label("break") == "breakdown"
    assert normalize_ml_label("something-new") == "unknown"


def test_ml_sections_anchor_to_native_grid():
    beat_times = [i * 0.5 for i in range(100)]  # native truth
    segs = [
        {"start": 0.0, "end": 8.0, "label": "intro", "confidence": 0.9},
        {"start": 8.0, "end": 24.0, "label": "verse", "confidence": 0.7},
        {
            "start": 24.0,
            "end": 24.0,
            "label": "drop",
            "confidence": 0.9,
        },  # empty → skipped
    ]
    out = ml_sections(segs, beat_times)
    assert len(out) == 2
    assert out[0]["kind"] == "intro"
    assert out[0]["startBeat"] == 1
    assert out[0]["endBeat"] == 17
    assert out[0]["evidence"] == ["allin1:boundary"]
    assert out[0]["rawLabel"] == "allin1:intro"


def test_ml_sections_respect_confidence_floor():
    beat_times = [i * 0.5 for i in range(100)]
    segs = [{"start": 0.0, "end": 8.0, "label": "chorus", "confidence": 0.2}]
    assert ml_sections(segs, beat_times, min_confidence=0.5) == []


def test_allinone_absent_without_optional_dep():
    assert isinstance(allinone_available(), bool)
