from autolight_analysis.fusion import fuse, grid_warning, build_track_model
import pytest


def test_fuse_provenance():
    got = fuse("build", ["rekordbox:PSSI:Up", "energy:rising"], 0.91)
    assert got["evidence"] == ["rekordbox:PSSI:Up", "energy:rising"]


def test_grid_warning_only_on_disagreement():
    assert not grid_warning([0.0], [0.01])
    assert grid_warning([0.0], [0.2])


def test_build_track_model_sections():
    got = build_track_model(
        track_id="t1",
        analyzer_version="0.1.0",
        duration_seconds=200.0,
        beat_grid=[{"index": 0, "beatInBar": 1, "sourceTimeMs": 0.0, "bpm": 128.0}],
        phrases=[{"kind": "build", "rawLabel": "Up 1", "startBeat": 0, "endBeat": 32}],
        musical_events=[{"type": "drop", "beat": 32, "confidence": 0.9}],
        coverage="structured",
    )
    assert got["schemaVersion"] == 1
    assert got["sections"][0]["evidence"] == ["rekordbox:PSSI"]
    assert got["analysisCoverage"] == "structured"


def test_bad_coverage_rejected():
    with pytest.raises(ValueError):
        build_track_model(
            track_id="t", analyzer_version="v", duration_seconds=1.0,
            beat_grid=[], phrases=[], musical_events=[], coverage="nope",
        )
