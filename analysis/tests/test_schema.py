import pathlib

from autolight_analysis.events import EVENT_TYPES_19
from autolight_analysis.schema import (
    EVENT_TYPES,
    SCHEMA_VERSION,
    SECTION_KINDS,
    validate_track_model,
)


def test_valid_model_passes():
    from autolight_analysis.readiness import blank_inputs

    grid = [{"index": 0, "beatInBar": 1, "sourceTimeMs": 0.0, "bpm": 128.0}]
    inputs = blank_inputs()
    inputs["source.audio"] = {"status": "absent", "reason": "not attempted"}
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
        "readinessLevel": "adaptive",
        "analysisCoverage2": {"level": "adaptive", "inputs": inputs},
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
    assert any("schemaVersion=99" in p for p in problems)
    assert any("identity.id missing" in p for p in problems)
    assert any("beatInBar=5" in p for p in problems)
    assert any("bpm=0" in p for p in problems)
    assert any("section kind=nope" in p for p in problems)
    assert any("event type=nope" in p for p in problems)
    assert any("coverage=nope" in p for p in problems)
    assert any("sourceTimeMs missing" in p for p in problems)


def test_vocab_covers_contract():
    assert "prechorus" in SECTION_KINDS
    assert "major-section-transition" in EVENT_TYPES
    assert "drop-continuation" in EVENT_TYPES
    assert "bass-re-entry" in EVENT_TYPES
    assert set(EVENT_TYPES) == set(EVENT_TYPES_19)
    assert len(EVENT_TYPES) == len(EVENT_TYPES_19)


def _repo_root(start: pathlib.Path) -> pathlib.Path:
    for parent in (start, *start.parents):
        if (parent / "test-fixtures" / "analysis").is_dir():
            return parent
    raise AssertionError(f"test-fixtures/analysis not found above {start}")


def test_parity_fixture_parses_both_sides():
    import json

    root = _repo_root(pathlib.Path(__file__).resolve())
    path = root / "test-fixtures" / "analysis" / "trackmodel-v2.fixture.json"
    assert path.is_file(), f"parity fixture missing: {path}"
    model = json.loads(path.read_text())
    assert validate_track_model(model) == []
    assert model["schemaVersion"] == SCHEMA_VERSION
    assert set(model["musicalEvents"][0]) >= {"type", "beat", "confidence"}
    reparsed = json.loads(json.dumps(model, sort_keys=True))
    assert reparsed == json.loads(json.dumps(model))
    assert reparsed["analysisCoverage2"]["level"] == model["readinessLevel"]
