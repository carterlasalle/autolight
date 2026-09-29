from autolight_analysis.schema import validate_track_model, SECTION_KINDS, EVENT_TYPES


def test_valid_model_passes():
    model = {
        "schemaVersion": 1,
        "identity": {"id": "t", "sourceIds": {}},
        "durationSeconds": 10.0,
        "beatGrid": {"version": 1, "beats": [{"index": 0, "beatInBar": 1, "sourceTimeMs": 0.0, "bpm": 128.0}]},
        "sections": [{"kind": "build", "startBeat": 0, "endBeat": 8, "confidence": 0.9, "rawLabel": "Up 1"}],
        "musicalEvents": [{"type": "drop", "beat": 8, "confidence": 0.9}],
        "analysisCoverage": "structured",
    }
    assert validate_track_model(model) == []


def test_invalid_model_lists_problems():
    problems = validate_track_model({
        "schemaVersion": 2, "identity": {}, "beatGrid": {"beats": [{"beatInBar": 5, "bpm": 0}]},
        "sections": [{"kind": "nope"}], "musicalEvents": [{"type": "nope"}],
        "analysisCoverage": "nope",
    })
    assert len(problems) >= 5


def test_vocab_covers_contract():
    assert "prechorus" in SECTION_KINDS
    assert "section-transition" in EVENT_TYPES
