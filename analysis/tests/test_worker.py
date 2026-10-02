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


def test_analyze_full_with_real_audio(tmp_path):
    import pathlib

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
    assert model["analysisCoverage"] in ("full", "structured")
    assert model["analysisCoverage2"]["inputs"]["source.audio"]["status"] == "present"
    assert model["musicalEvents"], "real audio must yield DSP events"


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
