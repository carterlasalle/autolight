import json
from autolight_analysis.worker import handle


def test_ping():
    assert handle({"type": "ping"}) == {"type": "pong"}


def test_unknown():
    assert handle({"type": "nope"})["type"] == "error"


def test_analyze_structured(tmp_path):
    got = handle({
        "type": "analyze",
        "trackId": "t1",
        "audioPath": "/nonexistent.mp3",
        "nativeMetadataPath": "/Users/rocket/Library/Pioneer/rekordbox/share/PIONEER/USBANLZ/135/fb47d-24bc-49c5-b5e7-ce275ed46465",
    }, out_dir=tmp_path)
    assert got["type"] == "complete"
    model = json.loads(open(got["artifactPath"]).read())
    assert model["analysisCoverage"] == "structured"
    assert len(model["beatGrid"]["beats"]) > 100
    from autolight_analysis.schema import validate_track_model
    assert validate_track_model(model) == []


def test_analyze_missing_native_is_adaptive(tmp_path):
    got = handle({"type": "analyze", "trackId": "t2", "audioPath": "/x.mp3"}, out_dir=tmp_path)
    assert got["type"] == "complete"
    assert json.loads(open(got["artifactPath"]).read())["analysisCoverage"] == "adaptive"


def test_analyze_full_with_real_audio(tmp_path):
    got = handle({
        "type": "analyze",
        "trackId": "demo1",
        "audioPath": "/Users/rocket/Music/PioneerDJ/Demo Tracks/Demo Track 1.mp3",
        "nativeMetadataPath": "/Users/rocket/Library/Pioneer/rekordbox/share/PIONEER/USBANLZ/135/fb47d-24bc-49c5-b5e7-ce275ed46465",
    }, out_dir=tmp_path)
    assert got["type"] == "complete"
    model = json.loads(open(got["artifactPath"]).read())
    from autolight_analysis.schema import validate_track_model
    assert validate_track_model(model) == []
    assert model["analysisCoverage"] == "full"
    assert model["musicalEvents"], "real audio must yield DSP events"

def test_analyze_bad_dir_fails_cleanly(tmp_path):
    got = handle({
        "type": "analyze", "trackId": "t3", "audioPath": "/x.mp3",
        "nativeMetadataPath": "/does/not/exist",
    }, out_dir=tmp_path)
    assert got["type"] == "failed"
