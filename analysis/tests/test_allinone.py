import threading

from autolight_analysis.allinone import (
    _segment_confidence,
    allinone_available,
    is_unknown_kind,
    ml_sections,
    model_cache_dir,
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


def test_segment_confidence_prefers_model_probability():
    class Seg:
        def __init__(self, **fields):
            self.__dict__.update(fields)

    assert _segment_confidence(Seg(confidence=0.83)) == 0.83
    assert _segment_confidence(Seg(probability=0.61)) == 0.61
    assert _segment_confidence(Seg(confidence=2.0)) == 1.0
    assert _segment_confidence(Seg()) == 0.7


def test_model_cache_dir_offline_blocks_explicit_dir(monkeypatch):
    monkeypatch.setenv("AUTOLIGHT_OFFLINE", "1")
    try:
        model_cache_dir("/tmp/explicit-cache")
    except RuntimeError as err:
        assert "offlineOnly" in str(err)
    else:
        raise AssertionError("offline mode must block even an explicit cache dir")
    finally:
        monkeypatch.delenv("AUTOLIGHT_OFFLINE", raising=False)


def test_load_count_increments_once_under_threads(monkeypatch):
    import autolight_analysis.allinone as mod

    monkeypatch.setattr(mod, "_load_count", 0)
    monkeypatch.setattr(mod, "_session_info", None)
    monkeypatch.setattr(mod, "allinone_available", lambda: True)

    class FakeInfer:
        def analyze(self, **kwargs):
            return None

    monkeypatch.setitem(__import__("sys").modules, "allin1_infer", FakeInfer())
    threads = [
        threading.Thread(target=mod.analyze_full, args=("song.mp3",)) for _ in range(8)
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert mod.load_count() == 1


def test_unknown_sections_carry_unknown_evidence():
    beat_times = [i * 0.5 for i in range(100)]
    out = ml_sections(
        [{"start": 0.0, "end": 8.0, "label": "something-new", "confidence": 0.9}],
        beat_times,
    )
    assert out[0]["kind"] == "unknown"
    assert "allin1:unknown-label" in out[0]["evidence"]
    assert is_unknown_kind("unknown") is True
    assert is_unknown_kind("verse") is False
