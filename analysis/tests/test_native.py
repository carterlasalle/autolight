from autolight_analysis.native import (
    high_label,
    normalize_section,
    phrase_label,
    beat_grid_from_pqtz,
    phrases_from_pssi,
    extract_anlz,
)


class E:
    def __init__(self, **kw):
        self.__dict__.update(kw)


def test_high_variants():
    assert high_label(1, k1=1) == "Intro 1"
    assert high_label(1, k1=0) == "Intro 2"
    assert high_label(2, 0, 0, 0) == "Up 1"
    assert high_label(2, 0, 0, 1) == "Up 2"
    assert high_label(2, 0, 1, 0) == "Up 3"
    assert high_label(5, k1=0) == "Chorus 2"


def test_mid_low_labels():
    assert phrase_label(2, 8) == "Bridge"
    assert phrase_label(3, 9) == "Chorus"
    assert phrase_label(99, 4) == "Unknown4"


def test_normalize():
    assert normalize_section("Up 1") == "build"
    assert normalize_section("Down") == "breakdown"
    assert normalize_section("Verse 3") == "verse"
    assert normalize_section("Intro 2") == "intro"


def test_beat_grid_bpm_scaling():
    grid = beat_grid_from_pqtz([1, 2], [14200.0, 14200.0], [50.0, 473.0])
    assert grid[0]["bpm"] == 142.0
    assert grid[0]["beatInBar"] == 1
    assert grid[1]["sourceTimeMs"] == 473.0


def test_phrases_end_chain_and_fill():
    entries = [
        E(kind=1, k1=1, k2=0, k3=0, beat=1, fill=0, beat_fill=0),
        E(kind=5, k1=0, k2=0, k3=0, beat=33, fill=1, beat_fill=40),
    ]
    out = phrases_from_pssi(1, 0, 64, entries)
    assert out[0]["endBeat"] == 33
    assert out[1]["endBeat"] == 64
    assert out[1]["fillBeat"] == 40
    assert out[0]["raw"]["kind"] == 1


def test_extract_real_anlz():
    got = extract_anlz(
        "/Users/rocket/Library/Pioneer/rekordbox/share/PIONEER/USBANLZ/135/fb47d-24bc-49c5-b5e7-ce275ed46465"
    )
    assert len(got["beatGrid"]) > 100
    assert got["beatGrid"][0]["beatInBar"] == 1
    assert len(got["phrases"]) == 18
    assert got["phrases"][0]["rawLabel"] == "Intro 2"
    assert got["hasWaveform"] and got["has3Band"]
