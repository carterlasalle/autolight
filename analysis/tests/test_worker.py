import json
import pathlib

from autolight_analysis.worker import handle


def test_ping():
    assert handle({"type": "ping"}) == {"type": "pong"}


def test_unknown():
    assert handle({"type": "nope"})["type"] == "error"


def test_analyze_structured(tmp_path):
    sample = str(pathlib.Path(__file__).parent / "fixtures" / "anlz-sample")
    got = handle(
        {
            "type": "analyze",
            "trackId": "t1",
            "audioPath": "/nonexistent.mp3",
            "nativeMetadataPath": sample,
        },
        out_dir=tmp_path,
    )
    assert got["type"] == "complete"
    model = json.loads(pathlib.Path(got["artifactPath"]).read_text())
    assert model["analysisCoverage"] == "structured"
    assert len(model["beatGrid"]["beats"]) > 100
    from autolight_analysis.schema import validate_track_model

    assert validate_track_model(model) == []


def test_analyze_missing_native_is_typed_failure(tmp_path):
    # F-ANA-23: a nonexistent file returns typed failed (audio-missing),
    # not complete with an empty model.
    got = handle(
        {"type": "analyze", "trackId": "t2", "audioPath": "/x.mp3"}, out_dir=tmp_path
    )
    assert got["type"] == "failed"
    assert "audio-missing" in got.get("reason", "")


def test_analyze_real_audio_reaches_the_inputs_ceiling(tmp_path):
    fx = pathlib.Path(__file__).parent / "fixtures"
    got = handle(
        {
            "type": "analyze",
            "trackId": "demo1",
            "audioPath": str(fx / "synth-beats.wav"),
            "nativeMetadataPath": str(fx / "anlz-sample"),
        },
        out_dir=tmp_path,
    )
    assert got["type"] == "complete"
    model = json.loads(pathlib.Path(got["artifactPath"]).read_text())
    from autolight_analysis.schema import validate_track_model

    assert validate_track_model(model) == []
    assert model["musicalEvents"], "real audio must yield DSP events"
    # Defensive traversal: a renamed or missing field fails as a readable
    # assertion, not a KeyError three levels down (batch-53).
    coverage2 = model.get("analysisCoverage2") or {}
    inputs = coverage2.get("inputs") or {}
    statuses = {
        key: (value or {}).get("status")
        for key, value in inputs.items()
        if isinstance(value, dict)
    }
    source_audio = statuses.get("source.audio")

    assert source_audio == "present", f"artifact reports source.audio={source_audio!r}"
    # The coverage must match the ceiling its own reported inputs imply: with
    # no ML stage present the ceiling is structured, with one it is full. A
    # silent downgrade (dropped ML/plan stage) or an over-claim fails
    # (batch-53).
    ml_present = any(
        status == "present" for key, status in statuses.items() if key.startswith("ml.")
    )

    assert model["analysisCoverage"] == ("full" if ml_present else "structured"), (
        model["analysisCoverage"],
        statuses,
    )


def test_analyze_bad_dir_fails_cleanly(tmp_path):
    got = handle(
        {
            "type": "analyze",
            "trackId": "t3",
            "audioPath": "/x.mp3",
            "nativeMetadataPath": "/does/not/exist",
        },
        out_dir=tmp_path,
    )
    assert got["type"] == "failed"
    # The specific reason, not any failure: a bad native directory must route
    # to native-unreadable with the path named (batch-53).
    reason = got.get("reason", "")
    assert reason.startswith("native-unreadable"), reason
    assert "/does/not/exist" in reason, reason
