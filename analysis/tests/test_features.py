from autolight_analysis.features import energy_slope, rms
from autolight_analysis.events import is_fake_drop


def test_rising_slope_positive():
    assert energy_slope([0.1, 0.2, 0.4, 0.8]) > 0


def test_rms_silence():
    assert rms([0.0, 0.0]) == 0.0


def test_fake_drop_window():
    assert is_fake_drop(2, True)
    assert not is_fake_drop(8, True)
