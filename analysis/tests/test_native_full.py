"""Full ANLZ extraction with per-tag outcomes (T-RBL-04, P-5-anlz-full).

Every tag in §5.1-5.5 asserted with all fields; the EXT variant that raises
ConstError falls back per tag, keeping every other tag.
"""

import pathlib
import shutil
import tempfile

from autolight_analysis.native import (
    _cue_from_entry,
    beat_grid_from_pqtz,
    extract_anlz,
)

SAMPLE = pathlib.Path(__file__).parent / "fixtures" / "anlz-sample"


class E:
    def __init__(self, **kw):
        self.__dict__.update(kw)


def test_pqtz_full_fields():
    got = extract_anlz(str(SAMPLE))
    grid = got["beatGrid"]
    assert len(grid) > 100
    first = grid[0]
    assert set(first) >= {"index", "beatInBar", "sourceTimeMs", "bpm"}
    assert first["beatInBar"] == 1
    assert first["sourceTimeMs"] == 50.0
    assert grid[1]["sourceTimeMs"] == 473.0


def test_pssi_full_fields():
    got = extract_anlz(str(SAMPLE))
    assert len(got["phrases"]) == 18
    first = got["phrases"][0]
    assert first["rawLabel"] == "Intro 2"
    assert first["mood"] == 1
    assert first["bank"] == 0
    assert first["endBeatNative"] == 576
    assert first["endBeat"] == got["phrases"][1]["startBeat"]
    assert isinstance(first["rawHex"], str) and len(first["rawHex"]) == 48
    assert first["raw"]["kind"] == 1
    assert set(first) >= {
        "startBeat",
        "endBeat",
        "rawLabel",
        "kind",
        "mood",
        "bank",
        "fill",
        "fillBeat",
        "raw",
        "rawHex",
    }


def test_pco2_full_cue_fields():
    entry = E(
        hot_cue=3,
        time=12345,
        loop_time=13000,
        type=2,
        color_id=4,
        color_code=1,
        color_red=255,
        color_green=0,
        color_blue=90,
        comment="Drop",
        loop_enumerator=1,
        loop_denominator=2,
    )
    cue = _cue_from_entry("PCO2", entry)
    assert cue == {
        "source": "PCO2",
        "hotcue": 3,
        "timeMs": 12345,
        "loopTimeMs": 13000,
        "cueType": "2",
        "colorId": 4,
        "colorCode": 1,
        "rgb": {"r": 255, "g": 0, "b": 90},
        "comment": "Drop",
        "loopNumerator": 1,
        "loopDenominator": 2,
    }


def test_waveforms_retained_with_metadata():
    got = extract_anlz(str(SAMPLE))
    waves = got["waveforms"]
    for tag in ("PWAV", "PWV2", "PWV3", "PWV6", "PWV7"):
        assert tag in waves, f"{tag} missing"
        assert waves[tag]["columns"], f"{tag} has no columns"
        assert waves[tag]["shape"] and waves[tag]["dtype"], (
            f"{tag} has no shape metadata"
        )
    assert len(waves["PWV6"]["columns"]) == 3600
    assert waves["PWV6"]["encoding"] == "three-band-preview"
    assert waves["PWV7"]["encoding"] == "three-band-detail"
    assert got["hasWaveform"] and got["has3Band"]


def test_vocal_lane_with_raw():
    got = extract_anlz(str(SAMPLE))
    assert got["hasVocals"]
    assert got["vocal"]["lane"] == [109, 112, 115]
    assert got["vocal"]["raw"]["data"] == [109, 112, 115]
    assert "retained" in got["vocal"]["encoding"]


def test_per_tag_outcomes():
    got = extract_anlz(str(SAMPLE))
    by_tag = {o["tag"]: o for o in got["outcomes"]}
    for tag in (
        "PQTZ",
        "PSSI",
        "PCO2",
        "PCOB",
        "PWAV",
        "PWV2",
        "PWV3",
        "PWV6",
        "PWV7",
        "PWVC",
        "PPTH",
    ):
        assert by_tag[tag]["status"] == "ok", (tag, by_tag.get(tag))
    assert all(o["status"] in ("ok", "absent", "failed") for o in got["outcomes"])


def test_ext_variant_fallback_keeps_other_tags(monkeypatch):
    from pyrekordbox.anlz.file import AnlzFile

    real = AnlzFile.parse_file

    def boom(path, *a, **k):
        if str(path).endswith(".EXT"):
            from construct import ConstError

            raise ConstError("unknown EXT tag variant")
        return real(path, *a, **k)

    monkeypatch.setattr(AnlzFile, "parse_file", staticmethod(boom))
    got = extract_anlz(str(SAMPLE))
    assert len(got["beatGrid"]) > 100
    assert "PWAV" in got["waveforms"]
    statuses = {o["tag"]: o["status"] for o in got["outcomes"]}
    assert statuses["ANLZ0000.EXT"] == "failed"
    assert statuses["PSSI"] == "absent"
    assert got["phrases"] == []


def test_missing_2ex_reports_absent():
    tmp = pathlib.Path(tempfile.mkdtemp())
    try:
        shutil.copy(str(SAMPLE / "ANLZ0000.DAT"), str(tmp / "ANLZ0000.DAT"))
        got = extract_anlz(str(tmp))
        assert len(got["beatGrid"]) > 100
        assert got["vocal"] is None
        assert not got["hasVocals"] and not got["has3Band"]
        statuses = {o["tag"]: o["status"] for o in got["outcomes"]}
        assert statuses["PWV6"] == "absent"
        assert statuses["PWVC"] == "absent"
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def test_beat_grid_units_unchanged():
    grid = beat_grid_from_pqtz([1, 2], [142.0, 142.0], [0.05, 0.473])
    assert grid[1]["sourceTimeMs"] == 473.0
