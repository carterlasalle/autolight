from autolight_analysis.schema import (
    EVENT_TYPES,
    SCHEMA_VERSION,
    SECTION_KINDS,
    validate_track_model,
)


def test_valid_model_passes():
    grid = [{"index": 0, "beatInBar": 1, "sourceTimeMs": 0.0, "bpm": 128.0}]
    model = {
        "schemaVersion": SCHEMA_VERSION,
        "identity": {"id": "t", "sourceIds": {}},
        "durationSeconds": 10.0,
        "beatGrid": {"version": 1, "beats": grid},
        "sections": [
            {
                "kind": "build",
                "startBeat": 0,
                "endBeat": 1,
                "confidence": 0.9,
                "rawLabel": "Up 1",
            }
        ],
        "musicalEvents": [{"type": "drop", "beat": 0, "confidence": 0.9}],
        "analysisCoverage": "structured",
    }
    assert validate_track_model(model) == []


def test_invalid_model_lists_problems():
    problems = validate_track_model(
        {
            "schemaVersion": 99,
            "identity": {},
            "beatGrid": {"beats": [{"beatInBar": 5, "bpm": 0}]},
            "sections": [{"kind": "nope"}],
            "musicalEvents": [{"type": "nope"}],
            "analysisCoverage": "nope",
        }
    )
    assert len(problems) >= 5


def test_vocab_covers_contract():
    assert "prechorus" in SECTION_KINDS
    assert "major-section-transition" in EVENT_TYPES
    assert "drop-continuation" in EVENT_TYPES
    assert "bass-re-entry" in EVENT_TYPES
    assert len(EVENT_TYPES) == 19


def test_parity_fixture_parses_both_sides():
    import json
    import pathlib

    path = (
        pathlib.Path(__file__).parent.parent.parent
        / "test-fixtures"
        / "analysis"
        / "trackmodel-v2.fixture.json"
    )
    model = json.loads(path.read_text())
    assert validate_track_model(model) == []
    assert json.dumps(model, sort_keys=True) == json.dumps(
        json.loads(json.dumps(model, sort_keys=True)), sort_keys=True
    )
