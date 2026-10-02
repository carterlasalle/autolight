import pytest

from autolight_analysis.fusion import build_track_model, fuse
from autolight_analysis.metrical import grid_warning


def test_fuse_provenance():
    got = fuse("build", ["rekordbox:PSSI:Up", "energy:rising"], 0.91)
    assert got["evidence"] == ["rekordbox:PSSI:Up", "energy:rising"]


def test_grid_warning_only_on_disagreement():
    assert not grid_warning([0.0], [0.01])
    assert grid_warning([0.0], [0.2])


def test_build_track_model_sections():
    from autolight_analysis.readiness import blank_inputs

    inputs = blank_inputs()
    inputs["native.rekordbox.grid"] = {"status": "present"}
    inputs["native.rekordbox.pssi"] = {"status": "present"}
    got = build_track_model(
        track_id="t1",
        analyzer_version="0.1.0",
        duration_seconds=200.0,
        beat_grid=[{"index": 0, "beatInBar": 1, "sourceTimeMs": 0.0, "bpm": 128.0}],
        phrases=[
            {
                "kind": "build",
                "rawLabel": "Up 1",
                "startBeat": 0,
                "endBeat": 1,
                "evidence": ["rekordbox:PSSI:Up 1"],
            }
        ],
        musical_events=[
            {
                "type": "drop",
                "beat": 0,
                "confidence": 0.9,
                "strength": 0.8,
                "evidence": ["x"],
            },
        ],
        coverage="structured",
        inputs=inputs,
    )
    assert got["schemaVersion"] == 2
    assert got["sections"] == [
        {
            "kind": "build",
            "startBeat": 0,
            "endBeat": 1,
            "confidence": 0.8,
            "rawLabel": "Up 1",
            "evidence": ["rekordbox:PSSI:Up 1"],
        }
    ]
    # F-ANA-17: evidence is kept through the model, never stripped.
    assert got["musicalEvents"] == [
        {
            "type": "drop",
            "beat": 0,
            "confidence": 0.9,
            "strength": 0.8,
            "evidence": ["x"],
        }
    ]
    assert got["analysisCoverage"] == "structured"


def test_bad_coverage_rejected():
    with pytest.raises(ValueError):
        build_track_model(
            track_id="t",
            analyzer_version="v",
            duration_seconds=1.0,
            beat_grid=[],
            phrases=[],
            musical_events=[],
            coverage="nope",
        )
