from autolight_analysis.events import build_score, drop_score, is_fake_drop
from autolight_analysis.features import (
    beat_aggregate,
    energy_slope,
    rms,
    silence_probability,
    spectral_flux,
)


def test_rising_slope_positive():
    assert energy_slope([0.1, 0.2, 0.4, 0.8]) > 0


def test_rms_silence():
    assert rms([0.0, 0.0]) == 0.0


def test_fake_drop_window():
    assert is_fake_drop(2, True)
    assert not is_fake_drop(8, True)


def test_spectral_flux_onset():
    assert spectral_flux([0.1, 0.1], [0.5, 0.05]) == 0.4
    assert spectral_flux([0.5], [0.1]) == 0.0


def test_silence_probability():
    assert silence_probability(0.0) == 1.0
    assert silence_probability(1.0) == 0.0


def test_beat_aggregate():
    assert beat_aggregate([1.0, 3.0, 5.0, 7.0], 2) == [2.0, 6.0]


def test_build_score_evidence():
    got = build_score([0.1, 0.3, 0.6, 1.0], drum_slope=0.2, pssi_up=True)
    assert got["confidence"] > 0.5
    assert "rekordbox:PSSI:Up" in got["evidence"]


def test_drop_needs_convergence():
    weak = drop_score(0.1, 0.0, 0.0)
    strong = drop_score(
        0.8, 0.9, 0.7, preceded_by_build=True, on_downbeat=True, section_boundary=True
    )
    assert strong["confidence"] > weak["confidence"]
    assert strong["strength"] > weak["strength"]
